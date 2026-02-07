import { Context } from "grammy";
import { Config } from "../config.js";
import { invokeClaude } from "../claude/invoker.js";
import { SessionManager } from "../claude/session-manager.js";
import { ProjectManager } from "../projects/project-manager.js";
import { ChatLocks } from "../middleware/rate-limit.js";
import { InvocationLogger } from "../status/invocation-logger.js";
import { ChatAgent } from "../agents/chat-agent.js";
import { Executor } from "../agents/executor.js";
import { startTypingIndicator, sendResponse } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";
import https from "https";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";

/**
 * Download a file from a URL into a Buffer using native https.
 */
async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode} downloading file`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Infer MIME type from Telegram file_path extension.
 * Telegram photos are almost always JPEG, but we handle other cases.
 */
function inferMediaType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "jpg":
    case "jpeg":
    default:
      return "image/jpeg";
  }
}

export async function handleMedia(
  ctx: Context,
  config: Config,
  sessionManager: SessionManager,
  projectManager: ProjectManager,
  chatLocks: ChatLocks,
  invocationLogger: InvocationLogger,
  chatAgent: ChatAgent,
  executor: Executor,
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Telegram sends photos as an array of sizes — take the highest quality (last element)
  const photo = ctx.message?.photo?.at(-1);
  if (!photo) return;

  // Lock chat so only one request processes at a time
  const controller = chatLocks.lock(chatId);
  const stopTyping = startTypingIndicator(ctx);

  try {
    // Get the file info from Telegram
    const file = await ctx.getFile();
    if (!file.file_path) {
      throw new Error("Could not get file path from Telegram");
    }

    const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    const mediaType = inferMediaType(file.file_path);

    logger.info({ chatId, fileId: photo.file_id, mediaType }, "Downloading media file from Telegram");

    // Download and base64-encode the image
    const fileBuffer = await downloadFile(fileUrl);
    const base64 = fileBuffer.toString("base64");

    logger.info({ chatId, fileSizeBytes: fileBuffer.length }, "Media file downloaded, encoded to base64");

    // Caption text — fall back to a description if the user didn't include one
    const caption = ctx.message?.caption || "(Image sent without caption)";

    // Get project directory
    const projectDir = projectManager.getActiveProjectDir(chatId) || config.defaultProjectDir;

    // Save image to a temp file in the project directory
    const tempImageName = `temp_image_${Date.now()}.${mediaType === "image/png" ? "png" : "jpg"}`;
    const tempImagePath = join(projectDir, tempImageName);

    await writeFile(tempImagePath, Buffer.from(base64, "base64"));
    logger.info({ chatId, tempImagePath }, "Saved image to temp file");

    // Build prompt that references the saved image file
    const prompt = `${caption}\n\n[User sent an image file: ${tempImageName}]\n\nPlease analyze this image and respond.`;

    logger.info({ chatId, projectDir, captionLength: caption.length }, "Processing media via executor pipeline");

    // Step 1: Chat Agent — invoke normally (image file is in cwd)
    const chatResult = await chatAgent.invoke({
      chatId,
      prompt,
      cwd: projectDir,
      abortSignal: controller.signal,
      onInvocation: (raw) => {
        const entry = Array.isArray(raw)
          ? raw.find((item: any) => item.type === "result") || raw[0]
          : raw;
        if (entry) {
          invocationLogger.log({
            timestamp: Date.now(),
            chatId,
            tier: "chat",
            durationMs: entry.durationms || entry.duration_ms,
            durationApiMs: entry.durationapims || entry.duration_api_ms,
            costUsd: entry.totalcostusd || entry.total_cost_usd || entry.cost_usd,
            numTurns: entry.numturns || entry.num_turns,
            stopReason: entry.subtype || entry.stopreason || entry.stop_reason,
            isError: entry.iserror || entry.is_error || false,
            modelUsage: entry.modelUsage || entry.model_usage,
          }).catch((err) => logger.error({ err }, "Failed to log chat invocation"));
        }
      },
    });

    // Step 2: Send immediate chat response
    if (chatResult.chatResponse) {
      await sendResponse(ctx, chatResult.chatResponse);
    }

    // Step 3: If work is needed, execute
    if (chatResult.workRequest) {
      logger.info({ chatId, task: chatResult.workRequest.task }, "Work request detected from media, starting execution");

      const result = await executor.execute({
        chatId,
        task: chatResult.workRequest.task,
        context: chatResult.workRequest.context || "",
        complexity: chatResult.workRequest.complexity || "moderate",
        rawMessage: caption,
        cwd: projectDir,
        abortSignal: controller.signal,
        onStatusUpdate: async (update) => {
          const msg = update.progress
            ? `${update.message} (${update.progress})`
            : update.message;
          await ctx.reply(msg).catch(() => {});
        },
        onInvocation: (raw) => {
          const entry = Array.isArray(raw)
            ? raw.find((item: any) => item.type === "result") || raw[0]
            : raw;
          if (entry) {
            invocationLogger.log({
              timestamp: Date.now(),
              chatId,
              tier: "executor",
              durationMs: entry.durationms || entry.duration_ms,
              durationApiMs: entry.durationapims || entry.duration_api_ms,
              costUsd: entry.totalcostusd || entry.total_cost_usd || entry.cost_usd,
              numTurns: entry.numturns || entry.num_turns,
              stopReason: entry.subtype || entry.stopreason || entry.stop_reason,
              isError: entry.iserror || entry.is_error || false,
              modelUsage: entry.modelUsage || entry.model_usage,
            }).catch((err) => logger.error({ err }, "Failed to log executor invocation"));
          }
        },
      });

      // Step 4: Get Tiffany-voiced summary of the work
      const summaryPrompt = `Work has been completed. Here's the executor's report:\n\n${result.result}\n\nOverall success: ${result.success}\nDuration: ${Math.round(result.durationMs / 1000)}s\nCost: $${result.costUsd.toFixed(4)}\n\nSummarize this for the user in your own words.`;

      const finalResult = await chatAgent.invoke({
        chatId,
        prompt: summaryPrompt,
        cwd: projectDir,
        abortSignal: controller.signal,
        onInvocation: (raw) => {
          const entry = Array.isArray(raw)
            ? raw.find((item: any) => item.type === "result") || raw[0]
            : raw;
          if (entry) {
            invocationLogger.log({
              timestamp: Date.now(),
              chatId,
              tier: "chat",
              durationMs: entry.durationms || entry.duration_ms,
              durationApiMs: entry.durationapims || entry.duration_api_ms,
              costUsd: entry.totalcostusd || entry.total_cost_usd || entry.cost_usd,
              numTurns: entry.numturns || entry.num_turns,
              stopReason: entry.subtype || entry.stopreason || entry.stop_reason,
              isError: entry.iserror || entry.is_error || false,
              modelUsage: entry.modelUsage || entry.model_usage,
            }).catch((err) => logger.error({ err }, "Failed to log chat summary invocation"));
          }
        },
      });

      await sendResponse(ctx, finalResult.chatResponse || result.result);

      logger.info({
        chatId,
        success: result.success,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      }, "Media execution complete");
    }

    // Save sessions
    await sessionManager.save();

    logger.info({ chatId, costUsd: chatResult.claudeResult.costUsd }, "Media message processed");
  } catch (err: any) {
    if (err.message === "Cancelled") {
      logger.info({ chatId }, "Media request cancelled");
      return;
    }

    logger.error({ chatId, err }, "Error handling media");

    const userMessage = err.message?.includes("Rate limited")
      ? "Claude is rate limited. Please wait a moment and try again."
      : err.message?.includes("timed out")
        ? "Request timed out. Try a simpler question or increase the timeout."
        : `Error processing image: ${err.message}`;

    await ctx.reply(userMessage).catch(() => {});
  } finally {
    stopTyping();
    chatLocks.unlock(chatId);
  }
}
