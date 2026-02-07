import { Context } from "grammy";
import { spawn } from "child_process";
import { Config } from "../config.js";
import { SessionManager } from "../claude/session-manager.js";
import { ProjectManager } from "../projects/project-manager.js";
import { ChatLocks } from "../middleware/rate-limit.js";
import { InvocationLogger } from "../status/invocation-logger.js";
import { ChatAgent } from "../agents/chat-agent.js";
import { Executor } from "../agents/executor.js";
import { PendingResponseManager } from "../pending-responses.js";
import { MemoryManager } from "../memory-manager.js";
import { startTypingIndicator, sendResponse, editMessage } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";

// Module-level references so executeInBackground can access them
let _pendingResponses: PendingResponseManager | null = null;
let _memoryManager: MemoryManager | null = null;

export async function handleMessage(
  ctx: Context,
  config: Config,
  sessionManager: SessionManager,
  projectManager: ProjectManager,
  chatLocks: ChatLocks,
  invocationLogger: InvocationLogger,
  chatAgent: ChatAgent,
  executor: Executor,
  pendingResponses?: PendingResponseManager,
  memoryManager?: MemoryManager,
): Promise<void> {
  if (pendingResponses) _pendingResponses = pendingResponses;
  if (memoryManager) _memoryManager = memoryManager;
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text;
  if (!chatId || !text) return;

  // Lock chat
  const controller = chatLocks.lock(chatId);
  const stopTyping = startTypingIndicator(ctx);

  try {
    // Get project directory
    const projectDir = projectManager.getActiveProjectDir(chatId) || config.defaultProjectDir;

    logger.info({ chatId, projectDir, promptLength: text.length }, "Processing message via executor pipeline");

    // Build memory context for this user
    const memoryContext = _memoryManager?.buildMemoryContext(chatId) ?? undefined;

    // Step 1: Chat Agent — decides if this is chat or work
    const chatResult = await chatAgent.invoke({
      chatId,
      prompt: text,
      cwd: projectDir,
      abortSignal: controller.signal,
      memoryContext,
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

    // Save any auto-detected memory notes
    if (chatResult.memoryNote && _memoryManager) {
      _memoryManager.addNote(chatId, chatResult.memoryNote, "auto");
    }

    // Step 2: Send immediate chat response
    if (chatResult.chatResponse) {
      await sendResponse(ctx, chatResult.chatResponse);
    }

    // Save sessions
    await sessionManager.save();

    logger.info({ chatId, costUsd: chatResult.claudeResult.costUsd }, "Message processed");

    // Step 3: If work is needed, execute in the BACKGROUND
    if (chatResult.workRequest) {
      logger.info({ chatId, task: chatResult.workRequest.task, complexity: chatResult.workRequest.complexity }, "Work request detected, starting background execution");

      executeInBackground(
        chatId,
        text,
        chatResult.workRequest,
        projectDir,
        ctx,
        executor,
        chatAgent,
        invocationLogger,
        memoryContext,
      ).catch((err) => {
        logger.error({ chatId, err }, "Background execution failed");
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
 * Runs executor in the background without blocking the message handler.
 */
async function executeInBackground(
  chatId: number,
  rawMessage: string,
  workRequest: any,
  projectDir: string,
  ctx: Context,
  executor: Executor,
  chatAgent: ChatAgent,
  invocationLogger: InvocationLogger,
  memoryContext?: string,
): Promise<void> {
  try {
    // Send initial "working" message — this one gets edited in-place for heartbeats
    let workingMessageId: number | null = null;
    try {
      const msg = await ctx.reply("Working on your request...");
      workingMessageId = msg.message_id;
    } catch (err) {
      logger.warn({ chatId, err }, "Failed to send initial working message");
    }

    // Rate-limit tracker for transient edits only
    let lastEditTime = 0;
    const EDIT_THROTTLE_MS = 5000;

    const result = await executor.execute({
      chatId,
      task: workRequest.task,
      context: workRequest.context || "",
      complexity: workRequest.complexity || "moderate",
      rawMessage,
      memoryContext,
      cwd: projectDir,
      onStatusUpdate: async (update) => {
        if (update.important) {
          // Important updates -> new message (user gets notification)
          try {
            await ctx.reply(update.message);
          } catch {
            await ctx.reply(update.message.replace(/[*_`]/g, "")).catch(() => {});
          }
        } else {
          // Transient updates -> edit working message in-place
          if (!workingMessageId) return;
          const now = Date.now();
          if (now - lastEditTime < EDIT_THROTTLE_MS) return;
          lastEditTime = now;
          await editMessage(ctx, workingMessageId, `${update.message}`).catch(() => {});
        }
      },
      onInvocation: (raw) => {
        const entry = Array.isArray(raw)
          ? raw.find((item: any) => item.type === "result") || raw[0]
          : raw;
        if (entry) {
          invocationLogger.log({
            timestamp: Date.now(),
            chatId,
            tier: entry._tier || "executor",
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

    // Get Tiffany-voiced summary (with memory context)
    const summaryPrompt = `Work has been completed. Here's the executor's report:\n\n${result.result}\n\nOverall success: ${result.success}\nDuration: ${Math.round(result.durationMs / 1000)}s\nCost: $${result.costUsd.toFixed(4)}\n\nSummarize this for the user in your own words.`;

    const currentMemoryContext = _memoryManager?.buildMemoryContext(chatId) ?? undefined;

    const finalResult = await chatAgent.invoke({
      chatId,
      prompt: summaryPrompt,
      cwd: projectDir,
      memoryContext: currentMemoryContext,
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

    // Save any memory notes from the summary response
    if (finalResult.memoryNote && _memoryManager) {
      _memoryManager.addNote(chatId, finalResult.memoryNote, "auto");
    }

    // Build final message
    const finalMsg = finalResult.chatResponse || result.result;
    const prefix = result.success ? "✅" : "❌";
    const fullMsg = `${prefix} ${finalMsg}`;

    // Persist to disk BEFORE sending — survives process death
    let pendingId: string | null = null;
    if (_pendingResponses) {
      pendingId = _pendingResponses.add(chatId, fullMsg, result.success);
    }

    // Delete the working message and send final result as NEW message
    if (workingMessageId) {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, workingMessageId);
      } catch {
        await editMessage(ctx, workingMessageId, "Done — see below").catch(() => {});
      }
    }

    await sendResponse(ctx, fullMsg);

    // Response delivered — remove from pending
    if (pendingId && _pendingResponses) {
      _pendingResponses.remove(pendingId);
    }

    // Check if a restart is needed
    let shouldRestart = result.needsRestart;

    if (!shouldRestart) {
      const textToCheck = [result.result, workRequest.task || ""].join(" ").toLowerCase();
      const mentionsRestart = textToCheck.includes("restart");
      const mentionsService = textToCheck.includes("tiffbot") || textToCheck.includes("service");
      if (mentionsRestart && mentionsService) {
        shouldRestart = true;
      }
    }

    if (shouldRestart) {
      logger.info({ chatId }, "Scheduling delayed tiffbot restart...");
      const restartProc = spawn("bash", ["-c", "sleep 3 && sudo systemctl restart tiffbot"], {
        detached: true,
        stdio: "ignore",
      });
      restartProc.unref();
    }

    logger.info({
      chatId,
      success: result.success,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      restartScheduled: shouldRestart,
    }, "Background execution complete");
  } catch (err: any) {
    logger.error({ chatId, err }, "Background execution error");
    await ctx.reply(`Work failed: ${err.message}`).catch(() => {});
  }
}
