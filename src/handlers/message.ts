import { Context } from "grammy";
import { Config } from "../config.js";
import { invokeClaude } from "../claude/invoker.js";
import { SessionManager } from "../claude/session-manager.js";
import { ProjectManager } from "../projects/project-manager.js";
import { ChatLocks } from "../middleware/rate-limit.js";
import { InvocationLogger } from "../status/invocation-logger.js";
import { startTypingIndicator, sendResponse } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";

export async function handleMessage(
  ctx: Context,
  config: Config,
  sessionManager: SessionManager,
  projectManager: ProjectManager,
  chatLocks: ChatLocks,
  invocationLogger: InvocationLogger
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

    // Get existing session
    const sessionId = sessionManager.getSessionId(chatId);

    logger.info({ chatId, sessionId, projectDir, promptLength: text.length }, "Invoking Claude");

    const result = await invokeClaude({
      prompt: text,
      cwd: projectDir,
      sessionId,
      abortSignal: controller.signal,
      config,
      onInvocation: (raw) => {
        // Extract invocation data from raw CLI response
        const entry = Array.isArray(raw)
          ? raw.find((item: any) => item.type === "result") || raw[0]
          : raw;
        if (entry) {
          invocationLogger.log({
            timestamp: Date.now(),
            chatId,
            durationMs: entry.durationms || entry.duration_ms,
            durationApiMs: entry.durationapims || entry.duration_api_ms,
            costUsd: entry.totalcostusd || entry.total_cost_usd || entry.cost_usd,
            numTurns: entry.numturns || entry.num_turns,
            stopReason: entry.subtype || entry.stopreason || entry.stop_reason,
            isError: entry.iserror || entry.is_error || false,
            modelUsage: entry.modelUsage || entry.model_usage,
          }).catch((err) => logger.error({ err }, "Failed to log invocation"));
        }
      },
    });

    // Update session
    if (result.sessionId) {
      sessionManager.set(chatId, result.sessionId, projectDir);
    }

    // Save sessions periodically
    await sessionManager.save();

    // Send response
    const response = result.isError
      ? `Error from Claude:\n${result.result}`
      : result.result;

    await sendResponse(ctx, response || "(empty response)");

    logger.info(
      { chatId, sessionId: result.sessionId, costUsd: result.costUsd, duration: result.duration },
      "Claude response sent"
    );
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
