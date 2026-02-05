import { Context } from "grammy";
import { Config } from "../config.js";
import { SessionManager } from "../claude/session-manager.js";
import { ProjectManager } from "../projects/project-manager.js";
import { ChatLocks } from "../middleware/rate-limit.js";
import { InvocationLogger } from "../status/invocation-logger.js";
import { ChatAgent } from "../agents/chat-agent.js";
import { Orchestrator } from "../agents/orchestrator.js";
import { startTypingIndicator, sendResponse, editMessage } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";

export async function handleMessage(
  ctx: Context,
  config: Config,
  sessionManager: SessionManager,
  projectManager: ProjectManager,
  chatLocks: ChatLocks,
  invocationLogger: InvocationLogger,
  chatAgent: ChatAgent,
  orchestrator: Orchestrator,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text;
  if (!chatId || !text) return;

  // Lock chat
  const controller = chatLocks.lock(chatId);
  const stopTyping = startTypingIndicator(ctx);

  try {
    // Get project directory
    const projectDir = projectManager.getActiveProjectDir(chatId) || config.defaultProjectDir;

    logger.info({ chatId, projectDir, promptLength: text.length }, "Processing message via three-tier pipeline");

    // Step 1: Chat Agent — decides if this is chat or work
    const chatResult = await chatAgent.invoke({
      chatId,
      prompt: text,
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

    // Save sessions
    await sessionManager.save();

    logger.info({ chatId, costUsd: chatResult.claudeResult.costUsd }, "Message processed");

    // Step 3: If work is needed, orchestrate in the BACKGROUND
    // This allows the chat lock to be released immediately, so the user can keep interacting
    if (chatResult.workRequest) {
      logger.info({ chatId, task: chatResult.workRequest.task }, "Work request detected, starting background orchestration");

      // Run orchestration in background without awaiting
      orchestrateInBackground(
        chatId,
        chatResult.workRequest,
        projectDir,
        ctx,
        orchestrator,
        chatAgent,
        invocationLogger
      ).catch((err) => {
        logger.error({ chatId, err }, "Background orchestration failed");
        ctx.reply(`Background work failed: ${err.message}`).catch(() => {});
      });
    }
  } catch (err: any) {
    if (err.message === "Cancelled") {
      logger.info({ chatId }, "Request cancelled");
      return;
    }

    logger.error({ chatId, err }, "Error handling message");

    const userMessage = err.message?.includes("Rate limited")
      ? "Claude is rate limited. Please wait a moment and try again."
      : err.message?.includes("timed out")
        ? "Request timed out. Try a simpler question or increase the timeout."
        : `Error: ${err.message}`;

    await ctx.reply(userMessage).catch(() => {});
  } finally {
    stopTyping();
    chatLocks.unlock(chatId);
  }
}

/**
 * Runs orchestration in the background without blocking the message handler.
 * This is a fire-and-forget operation that doesn't hold the chat lock.
 */
async function orchestrateInBackground(
  chatId: number,
  workRequest: any,
  projectDir: string,
  ctx: Context,
  orchestrator: Orchestrator,
  chatAgent: ChatAgent,
  invocationLogger: InvocationLogger
): Promise<void> {
  try {
    // Send initial "working..." message and capture its messageId for editing
    let workingMessageId: number | null = null;
    try {
      const msg = await ctx.reply("⏳ Working on your request...");
      workingMessageId = msg.message_id;
    } catch {
      // If initial message fails, orchestration can continue without editing
    }

    const summary = await orchestrator.execute({
      chatId,
      workRequest,
      cwd: projectDir,
      onStatusUpdate: async (update) => {
        if (!workingMessageId) return;
        const msg = update.progress ? `${update.message} (${update.progress})` : update.message;
        // Edit the working message with progress
        await editMessage(ctx, workingMessageId, `⏳ ${msg}`).catch(() => {});
      },
      onInvocation: (raw) => {
        const entry = Array.isArray(raw)
          ? raw.find((item: any) => item.type === "result") || raw[0]
          : raw;
        if (entry) {
          invocationLogger.log({
            timestamp: Date.now(),
            chatId,
            tier: "orchestrator",
            durationMs: entry.durationms || entry.duration_ms,
            durationApiMs: entry.durationapims || entry.duration_api_ms,
            costUsd: entry.totalcostusd || entry.total_cost_usd || entry.cost_usd,
            numTurns: entry.numturns || entry.num_turns,
            stopReason: entry.subtype || entry.stopreason || entry.stop_reason,
            isError: entry.iserror || entry.is_error || false,
            modelUsage: entry.modelUsage || entry.model_usage,
          }).catch(() => {});
        }
      },
    });

    // Get Tiffany-voiced summary
    const summaryPrompt = `Work has been completed. Here's a summary of what was done:\n\n${summary.summary}\n\nOverall success: ${summary.overallSuccess}\nTotal cost: $${summary.totalCostUsd.toFixed(4)}\n\nSummarize this for the user in your own words.`;

    const finalResult = await chatAgent.invoke({
      chatId,
      prompt: summaryPrompt,
      cwd: projectDir,
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
          }).catch(() => {});
        }
      },
    });

    // Update the working message with final result, or send if message editing failed
    const finalMsg = finalResult.chatResponse || summary.summary;
    if (workingMessageId) {
      const prefix = summary.overallSuccess ? "✅" : "❌";
      await editMessage(ctx, workingMessageId, `${prefix} ${finalMsg}`).catch(async () => {
        // If editing fails, send as new message
        await sendResponse(ctx, finalMsg);
      });
    } else {
      await sendResponse(ctx, finalMsg);
    }

    logger.info({
      chatId,
      overallSuccess: summary.overallSuccess,
      workerCount: summary.workerResults.length,
      totalCostUsd: summary.totalCostUsd,
    }, "Background orchestration complete");
  } catch (err: any) {
    logger.error({ chatId, err }, "Background orchestration error");
    await ctx.reply(`Work failed: ${err.message}`).catch(() => {});
  }
}
