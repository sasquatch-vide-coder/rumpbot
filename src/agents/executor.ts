import { Config } from "../config.js";
import { invokeClaude } from "../claude/invoker.js";
import { AgentConfigManager } from "./agent-config.js";
import { AgentRegistry, agentRegistry as defaultRegistry } from "./agent-registry.js";
import { buildExecutorSystemPrompt } from "./prompts.js";
import type { ExecutorResult, StatusUpdate } from "./types.js";
import { logger } from "../utils/logger.js";

const STATUS_UPDATE_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 60000;
const STALL_WARNING_MS = 120000;
const STALL_KILL_MS = 300000;

// Timeout per complexity level
const TIMEOUT_BY_COMPLEXITY: Record<string, number> = {
  trivial: 5 * 60_000,     // 5 minutes
  moderate: 10 * 60_000,   // 10 minutes
  complex: 30 * 60_000,    // 30 minutes
};

// Max turns per complexity level
const MAX_TURNS_BY_COMPLEXITY: Record<string, number> = {
  trivial: 5,
  moderate: 20,
  complex: 50,
};

// Transient errors that warrant automatic retry
const TRANSIENT_ERROR_PATTERNS = [
  "rate limit",
  "429",
  "timed out",
  "timeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "socket hang up",
  "network error",
  "overloaded",
  "503",
  "502",
];

function isTransientError(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return remainingSec > 0 ? `${minutes}m ${remainingSec}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}

export class Executor {
  private registry: AgentRegistry;

  constructor(
    private config: Config,
    private agentConfig: AgentConfigManager,
    registry?: AgentRegistry,
  ) {
    this.registry = registry || defaultRegistry;
  }

  getRegistry(): AgentRegistry {
    return this.registry;
  }

  async execute(opts: {
    chatId: number;
    task: string;
    context: string;
    complexity: string;
    rawMessage: string;
    memoryContext?: string;
    cwd: string;
    abortSignal?: AbortSignal;
    onStatusUpdate?: (update: StatusUpdate) => void;
    onInvocation?: (raw: any) => void;
  }): Promise<ExecutorResult> {
    const tierConfig = this.agentConfig.getConfig("executor");
    const systemPrompt = buildExecutorSystemPrompt();
    const startTime = Date.now();
    const complexity = opts.complexity || "moderate";

    const maxTurns = MAX_TURNS_BY_COMPLEXITY[complexity] ?? MAX_TURNS_BY_COMPLEXITY.moderate;
    const executionTimeout = TIMEOUT_BY_COMPLEXITY[complexity] ?? TIMEOUT_BY_COMPLEXITY.moderate;

    logger.info({
      chatId: opts.chatId,
      task: opts.task,
      complexity,
      maxTurns,
      timeoutMs: executionTimeout,
    }, "Executor starting");

    // Register in agent registry
    const agentId = this.registry.register({
      role: "executor",
      chatId: opts.chatId,
      description: opts.task,
      phase: "executing",
    });

    // Execution-level timeout
    const execAbort = new AbortController();
    let execTimedOut = false;
    const execTimeout = setTimeout(() => {
      execTimedOut = true;
      execAbort.abort();
      logger.error({
        chatId: opts.chatId,
        agentId,
        elapsed: Date.now() - startTime,
      }, "Executor timeout — aborting");
      opts.onStatusUpdate?.({
        type: "status",
        message: `Execution timed out after ${formatDuration(executionTimeout)}. Aborting.`,
        important: true,
      });
    }, executionTimeout);

    // Link main abort signal to our controller
    const onMainAbort = () => execAbort.abort();
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        execAbort.abort();
      } else {
        opts.abortSignal.addEventListener("abort", onMainAbort, { once: true });
      }
    }

    const effectiveSignal = execAbort.signal;

    // Rate-limited status update sender
    let lastStatusTime = 0;
    const sendStatus = (update: StatusUpdate) => {
      const now = Date.now();
      if (now - lastStatusTime >= STATUS_UPDATE_INTERVAL_MS) {
        lastStatusTime = now;
        opts.onStatusUpdate?.(update);
      }
    };

    // Heartbeat + stall detection
    let lastActivityTime = Date.now();
    let stallWarned = false;

    const heartbeat = setInterval(() => {
      const elapsed = Date.now() - startTime;
      this.registry.update(agentId, { lastActivityAt: Date.now() });
      opts.onStatusUpdate?.({
        type: "status",
        message: `Still working (${formatDuration(elapsed)} elapsed)`,
      });
    }, HEARTBEAT_INTERVAL_MS);

    const stallCheck = setInterval(() => {
      const silentFor = Date.now() - lastActivityTime;

      if (silentFor >= STALL_WARNING_MS && !stallWarned) {
        stallWarned = true;
        const silentMin = Math.round(silentFor / 60000);
        opts.onStatusUpdate?.({
          type: "status",
          message: `Executor has been silent for ${silentMin} minutes — may be stalled`,
        });
        logger.warn({ agentId, silentForMs: silentFor }, "Executor may be stalled");
      }

      if (silentFor >= STALL_KILL_MS) {
        const silentMin = Math.round(silentFor / 60000);
        logger.error({ agentId, silentForMs: silentFor },
          "Executor stalled — killing after prolonged silence");
        opts.onStatusUpdate?.({
          type: "status",
          message: `Executor killed after ${silentMin} minutes of silence`,
          important: true,
        });
        execAbort.abort();
      }
    }, 30000);

    const onActivity = () => {
      lastActivityTime = Date.now();
      this.registry.update(agentId, { lastActivityAt: Date.now() });
      if (stallWarned) {
        stallWarned = false;
        sendStatus({
          type: "status",
          message: "Executor is active again",
        });
      }
    };

    const onOutput = (chunk: string) => {
      this.registry.addOutput(agentId, chunk);

      // Parse output for status updates
      const lines = chunk.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const lower = line.toLowerCase();
        // Look for file operations
        if (lower.includes("reading") || lower.includes("read file")) {
          const match = line.match(/(?:reading|read file)\s+(.+)/i);
          if (match) sendStatus({ type: "status", message: `Reading ${match[1].trim().slice(0, 60)}` });
        } else if (lower.includes("edited") || lower.includes("writing") || lower.includes("wrote")) {
          const match = line.match(/(?:edited|writing|wrote)\s+(.+)/i);
          if (match) sendStatus({ type: "status", message: `Editing ${match[1].trim().slice(0, 60)}` });
        } else if (lower.includes("running") && (lower.includes("npm") || lower.includes("git") || lower.includes("test"))) {
          sendStatus({ type: "status", message: line.trim().slice(0, 80) });
        }
      }
    };

    const cleanup = () => {
      clearInterval(heartbeat);
      clearInterval(stallCheck);
      clearTimeout(execTimeout);
      opts.abortSignal?.removeEventListener("abort", onMainAbort);
    };

    // Build the full prompt with all available context
    const promptParts: string[] = [];

    if (opts.memoryContext) {
      promptParts.push(`[MEMORY CONTEXT]\n${opts.memoryContext}\n`);
    }

    promptParts.push(`## Task\n${opts.task}`);

    if (opts.context) {
      promptParts.push(`\n## Context\n${opts.context}`);
    }

    promptParts.push(`\n## Original User Message\n${opts.rawMessage}`);
    promptParts.push(`\n## Working Directory\n${opts.cwd}`);

    const fullPrompt = promptParts.join("\n");

    // Execute with retry for transient errors
    let result: ExecutorResult;
    try {
      result = await this.invokeWithRetry({
        prompt: fullPrompt,
        cwd: opts.cwd,
        systemPrompt,
        model: tierConfig.model,
        maxTurns,
        abortSignal: effectiveSignal,
        onInvocation: (raw: any) => {
          if (raw && typeof raw === "object") {
            if (Array.isArray(raw)) {
              const entry = raw.find((item: any) => item.type === "result") || raw[0];
              if (entry) entry._tier = "executor";
            } else {
              raw._tier = "executor";
            }
          }
          opts.onInvocation?.(raw);
        },
        onActivity,
        onOutput,
        sendStatus,
      });
    } catch (err: any) {
      cleanup();
      const durationMs = Date.now() - startTime;

      this.registry.complete(agentId, false);

      logger.error({ agentId, err, durationMs }, "Executor failed");

      return {
        success: false,
        result: execTimedOut
          ? `Executor timed out after ${formatDuration(executionTimeout)}`
          : effectiveSignal.aborted
            ? "Executor was cancelled"
            : `Executor error: ${err.message}`,
        costUsd: 0,
        durationMs,
        needsRestart: false,
      };
    }

    cleanup();

    // Mark complete in registry
    this.registry.complete(agentId, result.success, result.costUsd);

    logger.info({
      chatId: opts.chatId,
      agentId,
      success: result.success,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    }, "Executor complete");

    return result;
  }

  private async invokeWithRetry(opts: {
    prompt: string;
    cwd: string;
    systemPrompt: string;
    model: string;
    maxTurns: number;
    abortSignal: AbortSignal;
    onInvocation: (raw: any) => void;
    onActivity: () => void;
    onOutput: (chunk: string) => void;
    sendStatus: (update: StatusUpdate) => void;
  }): Promise<ExecutorResult> {
    const startTime = Date.now();

    try {
      const result = await invokeClaude({
        prompt: opts.prompt,
        cwd: opts.cwd,
        abortSignal: opts.abortSignal,
        config: this.config,
        onInvocation: opts.onInvocation,
        systemPrompt: opts.systemPrompt,
        model: opts.model,
        maxTurnsOverride: opts.maxTurns,
        timeoutMsOverride: 0, // Managed by our own timeout
        onActivity: opts.onActivity,
        onOutput: opts.onOutput,
      });

      const durationMs = Date.now() - startTime;
      const needsRestart = detectRestartNeed(result.result);

      return {
        success: !result.isError,
        result: result.result,
        costUsd: result.costUsd || 0,
        durationMs,
        needsRestart,
      };
    } catch (err: any) {
      // Retry once for transient errors
      if (isTransientError(err.message)) {
        logger.info({ error: err.message }, "Executor hit transient error — retrying");
        opts.sendStatus({
          type: "status",
          message: "Hit transient error, retrying...",
          important: true,
        });

        await new Promise((r) => setTimeout(r, 3000));

        const result = await invokeClaude({
          prompt: opts.prompt,
          cwd: opts.cwd,
          abortSignal: opts.abortSignal,
          config: this.config,
          onInvocation: opts.onInvocation,
          systemPrompt: opts.systemPrompt,
          model: opts.model,
          maxTurnsOverride: opts.maxTurns,
          timeoutMsOverride: 0,
          onActivity: opts.onActivity,
          onOutput: opts.onOutput,
        });

        const durationMs = Date.now() - startTime;
        const needsRestart = detectRestartNeed(result.result);

        return {
          success: !result.isError,
          result: result.result,
          costUsd: result.costUsd || 0,
          durationMs,
          needsRestart,
        };
      }

      throw err;
    }
  }
}

function detectRestartNeed(output: string): boolean {
  const lower = output.toLowerCase();
  const mentionsRestart = lower.includes("restart needed") ||
    lower.includes("service restart") ||
    lower.includes("restart tiffbot") ||
    lower.includes("note: service restart needed");
  return mentionsRestart;
}
