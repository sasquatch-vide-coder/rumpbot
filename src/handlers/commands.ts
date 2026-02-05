import { Bot, Context } from "grammy";
import { Config } from "../config.js";
import { SessionManager } from "../claude/session-manager.js";
import { ProjectManager } from "../projects/project-manager.js";
import { ChatLocks } from "../middleware/rate-limit.js";
import { AgentConfigManager } from "../agents/agent-config.js";
import { invokeClaude } from "../claude/invoker.js";
import { startTypingIndicator, sendResponse } from "../utils/telegram.js";
import { logger } from "../utils/logger.js";
import { Orchestrator } from "../agents/orchestrator.js";
import { AgentRegistry } from "../agents/agent-registry.js";

export function registerCommands(
  bot: Bot,
  config: Config,
  sessionManager: SessionManager,
  projectManager: ProjectManager,
  chatLocks: ChatLocks,
  agentConfig: AgentConfigManager,
  orchestrator?: Orchestrator,
  registry?: AgentRegistry,
): void {
  bot.command("start", (ctx) => {
    ctx.reply(
      "TIFFBOT is ready. Send me a message and I'll pass it to Claude Code.\n\n" +
      "Commands:\n" +
      "/help - Show this help\n" +
      "/status - Current session info\n" +
      "/reset - Clear conversation session\n" +
      "/cancel - Abort current request\n" +
      "/kill <n> - Kill worker #n\n" +
      "/retry <n> - Retry failed worker #n\n" +
      "/model - Show agent model config\n" +
      "/project - Manage projects\n" +
      "/git - Git operations"
    );
  });

  bot.command("help", (ctx) => {
    ctx.reply(
      "*Commands:*\n" +
      "/status - Session & project info\n" +
      "/reset - Clear conversation context\n" +
      "/cancel - Abort entire orchestration\n" +
      "/kill <n> - Kill specific worker #n\n" +
      "/retry <n> - Retry failed/killed worker #n\n" +
      "/model - Show agent model config\n" +
      "/project list - Show projects\n" +
      "/project add <name> <path> - Add project\n" +
      "/project switch <name> - Switch project\n" +
      "/project remove <name> - Remove project\n" +
      "/git status|commit|push|pr - Git operations\n\n" +
      "Just send a text message to chat with Claude.",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("status", (ctx) => {
    const chatId = ctx.chat.id;
    const session = sessionManager.get(chatId);
    const projectName = projectManager.getActiveProjectName(chatId) || "(default)";
    const projectDir = projectManager.getActiveProjectDir(chatId) || config.defaultProjectDir;
    const isProcessing = chatLocks.isLocked(chatId);

    const lines = [
      `*Status:*`,
      `Project: ${projectName}`,
      `Directory: \`${projectDir}\``,
      `Session: ${session?.sessionId ? `\`${session.sessionId.slice(0, 8)}...\`` : "none"}`,
      `Processing: ${isProcessing ? "yes" : "no"}`,
    ];

    if (session?.lastUsedAt) {
      const ago = Math.round((Date.now() - session.lastUsedAt) / 60000);
      lines.push(`Last used: ${ago}m ago`);
    }

    ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.command("reset", async (ctx) => {
    const chatId = ctx.chat.id;
    sessionManager.clear(chatId);
    await sessionManager.save();
    ctx.reply("Session cleared. Next message starts fresh.");
  });

  bot.command("cancel", (ctx) => {
    const chatId = ctx.chat.id;
    if (chatLocks.cancel(chatId)) {
      ctx.reply("Request cancelled.");
    } else {
      ctx.reply("Nothing to cancel.");
    }
  });

  // /kill <n> — kill a specific worker by number
  bot.command("kill", async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = (ctx.match as string || "").trim();
    const workerNumber = parseInt(arg, 10);

    if (!arg || isNaN(workerNumber) || workerNumber < 1) {
      await ctx.reply("Usage: /kill <worker_number>\nExample: /kill 3");
      return;
    }

    if (!registry) {
      await ctx.reply("Worker management is not available.");
      return;
    }

    const orch = registry.getActiveOrchestratorForChat(chatId);
    if (!orch) {
      await ctx.reply("No active orchestration running in this chat.");
      return;
    }

    const workerEntry = registry.getWorkerByNumber(orch.id, workerNumber);
    if (!workerEntry) {
      // List available workers
      const workers = registry.getWorkersForOrchestrator(orch.id);
      if (workers.size === 0) {
        await ctx.reply("No active workers found.");
        return;
      }
      const available = [...workers.values()]
        .map((w) => `  #${w.workerNumber}: ${w.taskDescription}`)
        .join("\n");
      await ctx.reply(`Worker #${workerNumber} not found. Active workers:\n${available}`);
      return;
    }

    // Abort just this worker
    workerEntry.info.controller.abort();
    await ctx.reply(`🔪 Killed worker #${workerNumber}: ${workerEntry.info.taskDescription}`);
    logger.info({ chatId, workerNumber, workerId: workerEntry.workerId }, "Worker killed by user");
  });

  // /retry <n> — retry a failed/killed worker by number
  bot.command("retry", async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = (ctx.match as string || "").trim();
    const workerNumber = parseInt(arg, 10);

    if (!arg || isNaN(workerNumber) || workerNumber < 1) {
      await ctx.reply("Usage: /retry <worker_number>\nExample: /retry 3");
      return;
    }

    if (!orchestrator || !registry) {
      await ctx.reply("Worker management is not available.");
      return;
    }

    const orch = registry.getActiveOrchestratorForChat(chatId);
    if (!orch) {
      await ctx.reply("No active orchestration running in this chat.");
      return;
    }

    // Check if we have a retry function available
    if (!orchestrator._activeRetryFn || orchestrator._activeOrchId !== orch.id) {
      await ctx.reply("Retry is not available for this orchestration.");
      return;
    }

    const workerEntry = registry.getWorkerByNumber(orch.id, workerNumber);
    if (!workerEntry) {
      await ctx.reply(`Worker #${workerNumber} not found or was not killed/failed. Only killed or failed workers can be retried.`);
      return;
    }

    await ctx.reply(`🔄 Retrying worker #${workerNumber}: ${workerEntry.info.taskDescription}`);
    logger.info({ chatId, workerNumber }, "Worker retry requested by user");

    // Run retry in background
    orchestrator._activeRetryFn(workerNumber)
      .then(async (result) => {
        if (!result) {
          await ctx.reply(`Failed to retry worker #${workerNumber}: worker not found.`).catch(() => {});
          return;
        }
        const icon = result.success ? "✅" : "❌";
        await ctx.reply(`${icon} Retry of worker #${workerNumber} ${result.success ? "succeeded" : "failed"}: ${result.result.slice(0, 500)}`).catch(() => {});
      })
      .catch(async (err) => {
        await ctx.reply(`Retry of worker #${workerNumber} errored: ${err.message}`).catch(() => {});
      });
  });

  bot.command("model", (ctx) => {
    const cfg = agentConfig.getAll();
    const lines = [
      "*Agent Models:*",
      `Chat: \`${cfg.chat.model}\` (${cfg.chat.maxTurns} turns, ${cfg.chat.timeoutMs === 0 ? "no timeout" : cfg.chat.timeoutMs / 1000 + "s"})`,
      `Orchestrator: \`${cfg.orchestrator.model}\` (${cfg.orchestrator.maxTurns} turns, ${cfg.orchestrator.timeoutMs === 0 ? "no timeout" : cfg.orchestrator.timeoutMs / 1000 + "s"})`,
      `Worker: \`${cfg.worker.model}\` (${cfg.worker.maxTurns} turns, ${cfg.worker.timeoutMs === 0 ? "no timeout" : cfg.worker.timeoutMs / 1000 + "s"})`,
    ];
    ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  // /project command
  bot.command("project", async (ctx) => {
    const chatId = ctx.chat.id;
    const args = (ctx.match as string || "").trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === "list") {
      const projects = projectManager.list();
      const activeName = projectManager.getActiveProjectName(chatId);

      if (projects.size === 0) {
        ctx.reply("No projects configured. Use `/project add <name> <path>` to add one.", { parse_mode: "Markdown" });
        return;
      }

      const lines = ["*Projects:*"];
      for (const [name, path] of projects) {
        const marker = name === activeName ? " (active)" : "";
        lines.push(`\`${name}\`${marker} → \`${path}\``);
      }
      ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
      return;
    }

    if (subcommand === "add") {
      const name = args[1];
      const path = args.slice(2).join(" ");
      if (!name || !path) {
        ctx.reply("Usage: `/project add <name> <path>`", { parse_mode: "Markdown" });
        return;
      }
      projectManager.add(name, path);
      await projectManager.save();
      ctx.reply(`Project \`${name}\` added → \`${path}\``, { parse_mode: "Markdown" });
      return;
    }

    if (subcommand === "switch") {
      const name = args[1];
      if (!name) {
        ctx.reply("Usage: `/project switch <name>`", { parse_mode: "Markdown" });
        return;
      }
      const path = projectManager.switchProject(chatId, name);
      if (!path) {
        ctx.reply(`Project \`${name}\` not found.`, { parse_mode: "Markdown" });
        return;
      }
      // Clear session when switching projects
      sessionManager.clear(chatId);
      await Promise.all([projectManager.save(), sessionManager.save()]);
      ctx.reply(`Switched to \`${name}\` (\`${path}\`). Session cleared.`, { parse_mode: "Markdown" });
      return;
    }

    if (subcommand === "remove") {
      const name = args[1];
      if (!name) {
        ctx.reply("Usage: `/project remove <name>`", { parse_mode: "Markdown" });
        return;
      }
      if (projectManager.remove(name)) {
        await projectManager.save();
        ctx.reply(`Project \`${name}\` removed.`, { parse_mode: "Markdown" });
      } else {
        ctx.reply(`Project \`${name}\` not found.`, { parse_mode: "Markdown" });
      }
      return;
    }

    ctx.reply("Unknown subcommand. Use: list, add, switch, remove");
  });

  // /git command
  bot.command("git", async (ctx) => {
    const chatId = ctx.chat.id;
    const args = (ctx.match as string || "").trim();
    const subcommand = args.split(/\s+/)[0]?.toLowerCase();

    if (!subcommand) {
      ctx.reply(
        "Usage:\n" +
        "/git status - Show git status\n" +
        "/git commit - Create a commit\n" +
        "/git push - Push to remote\n" +
        "/git pr - Create a pull request"
      );
      return;
    }

    const prompts: Record<string, string> = {
      status: "Run git status and git log --oneline -5, then give me a concise summary.",
      commit: "Review the current changes with git diff, then create a commit with an appropriate message. Show the result.",
      push: "Push the current branch to origin. Show the result.",
      pr: "Create a pull request for the current branch. Show the result.",
    };

    const prompt = prompts[subcommand];
    if (!prompt) {
      ctx.reply(`Unknown git subcommand: ${subcommand}. Use: status, commit, push, pr`);
      return;
    }

    if (chatLocks.isLocked(chatId)) {
      ctx.reply("Still processing a previous request. Use /cancel to abort it.");
      return;
    }

    const controller = chatLocks.lock(chatId);
    const stopTyping = startTypingIndicator(ctx);

    try {
      const projectDir = projectManager.getActiveProjectDir(chatId) || config.defaultProjectDir;
      const sessionId = sessionManager.getSessionId(chatId);

      const result = await invokeClaude({
        prompt,
        cwd: projectDir,
        sessionId,
        abortSignal: controller.signal,
        config,
      });

      if (result.sessionId) {
        sessionManager.set(chatId, result.sessionId, projectDir);
        await sessionManager.save();
      }

      await sendResponse(ctx, result.result || "(empty response)");
    } catch (err: any) {
      if (err.message === "Cancelled") return;
      logger.error({ chatId, err }, "Error in git command");
      await ctx.reply(`Error: ${err.message}`).catch(() => {});
    } finally {
      stopTyping();
      chatLocks.unlock(chatId);
    }
  });
}
