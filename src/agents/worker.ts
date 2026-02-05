import { Config } from "../config.js";
import { invokeClaude } from "../claude/invoker.js";
import { AgentConfigManager } from "./agent-config.js";
import { buildWorkerSystemPrompt } from "./prompts.js";
import type { WorkerTask, WorkerResult } from "./types.js";
import { logger } from "../utils/logger.js";

export class WorkerAgent {
  constructor(
    private config: Config,
    private agentConfig: AgentConfigManager,
  ) {}

  async execute(opts: {
    task: WorkerTask;
    cwd: string;
    abortSignal?: AbortSignal;
    onInvocation?: (raw: any) => void;
    onActivity?: () => void;
    onOutput?: (chunk: string) => void;
  }): Promise<WorkerResult> {
    const tierConfig = this.agentConfig.getConfig("worker");
    const systemPrompt = buildWorkerSystemPrompt(opts.task.description);

    logger.info({ taskId: opts.task.id, description: opts.task.description }, "Worker starting task");

    const startTime = Date.now();

    try {
      const result = await invokeClaude({
        prompt: opts.task.prompt,
        cwd: opts.cwd,
        // No sessionId — workers are ephemeral
        abortSignal: opts.abortSignal,
        config: this.config,
        onInvocation: opts.onInvocation,
        systemPrompt,
        model: tierConfig.model,
        maxTurnsOverride: tierConfig.maxTurns,
        timeoutMsOverride: tierConfig.timeoutMs,
        onActivity: opts.onActivity,
        onOutput: opts.onOutput,
      });

      const duration = Date.now() - startTime;

      logger.info({
        taskId: opts.task.id,
        success: !result.isError,
        duration,
        costUsd: result.costUsd,
      }, "Worker completed task");

      return {
        taskId: opts.task.id,
        success: !result.isError,
        result: result.result,
        costUsd: result.costUsd,
        duration,
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;

      logger.error({ taskId: opts.task.id, err, duration }, "Worker task failed");

      return {
        taskId: opts.task.id,
        success: false,
        result: `Worker error: ${err.message}`,
        duration,
      };
    }
  }
}
