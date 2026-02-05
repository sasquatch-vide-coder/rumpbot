import { Config } from "../config.js";
import { invokeClaude } from "../claude/invoker.js";
import { SessionManager } from "../claude/session-manager.js";
import { AgentConfigManager } from "./agent-config.js";
import { WorkerAgent } from "./worker.js";
import { buildOrchestratorSystemPrompt } from "./prompts.js";
import type {
  WorkRequest,
  OrchestratorPlan,
  OrchestratorSummary,
  WorkerResult,
  StatusUpdate,
  WorkerTask,
} from "./types.js";
import { logger } from "../utils/logger.js";

const MAX_WORKERS = 10;
const STATUS_UPDATE_INTERVAL_MS = 10000; // Rate-limit status updates to 1 per 10s

export class Orchestrator {
  private workerAgent: WorkerAgent;

  constructor(
    private config: Config,
    private agentConfig: AgentConfigManager,
    private sessionManager: SessionManager,
  ) {
    this.workerAgent = new WorkerAgent(config, agentConfig);
  }

  async execute(opts: {
    chatId: number;
    workRequest: WorkRequest;
    cwd: string;
    abortSignal?: AbortSignal;
    onStatusUpdate?: (update: StatusUpdate) => void;
    onInvocation?: (raw: any) => void;
  }): Promise<OrchestratorSummary> {
    const tierConfig = this.agentConfig.getConfig("orchestrator");
    const systemPrompt = buildOrchestratorSystemPrompt();

    logger.info({ chatId: opts.chatId, task: opts.workRequest.task }, "Orchestrator starting");

    // Rate-limited status update sender
    let lastStatusTime = 0;
    const sendStatus = (update: StatusUpdate) => {
      const now = Date.now();
      if (now - lastStatusTime >= STATUS_UPDATE_INTERVAL_MS) {
        lastStatusTime = now;
        opts.onStatusUpdate?.(update);
      }
    };

    // Phase 1: Planning — ask the orchestrator to create a plan
    const planPrompt = [
      `Work request from user:`,
      `Task: ${opts.workRequest.task}`,
      `Context: ${opts.workRequest.context}`,
      `Urgency: ${opts.workRequest.urgency}`,
      ``,
      `Working directory: ${opts.cwd}`,
      ``,
      `Analyze this request and output a JSON plan.`,
    ].join("\n");

    sendStatus({ type: "status", message: "Planning the work..." });

    // Planning phase: always start fresh, no tools (pure planner), limited turns
    // The orchestrator must NOT have tools — if it has tools + 50 turns, it will
    // act as a full agent (reading files, running commands) and output prose summaries
    // instead of a JSON plan. Disabling tools forces pure JSON output.
    const planResult = await invokeClaude({
      prompt: planPrompt,
      cwd: opts.cwd,
      sessionId: undefined, // No session for planning — must be stateless
      abortSignal: opts.abortSignal,
      config: this.config,
      onInvocation: opts.onInvocation,
      systemPrompt,
      model: tierConfig.model,
      maxTurnsOverride: 1, // Planning is a single turn — just output JSON
      timeoutMsOverride: tierConfig.timeoutMs,
      allowedTools: "", // No tools — orchestrator is a pure planner, not an executor
    });

    // Parse the plan
    let plan: OrchestratorPlan;
    try {
      plan = parsePlan(planResult.result);
    } catch (err: any) {
      logger.error({ err, raw: planResult.result }, "Failed to parse orchestrator plan");
      return {
        type: "summary",
        overallSuccess: false,
        summary: `Planning failed: ${err.message}. The orchestrator did not produce a valid plan.`,
        workerResults: [],
        totalCostUsd: planResult.costUsd || 0,
      };
    }

    // Enforce max workers cap
    if (plan.workers.length > MAX_WORKERS) {
      logger.warn(
        { requested: plan.workers.length, cap: MAX_WORKERS },
        "Worker count exceeds cap, truncating"
      );
      plan.workers = plan.workers.slice(0, MAX_WORKERS);
    }

    logger.info({
      chatId: opts.chatId,
      summary: plan.summary,
      workerCount: plan.workers.length,
      sequential: plan.sequential,
    }, "Orchestrator plan created");

    sendStatus({
      type: "status",
      message: `Plan: ${plan.summary}`,
      progress: `0/${plan.workers.length} tasks`,
    });

    // Phase 2: Execute workers
    const workerResults: WorkerResult[] = [];
    let completedCount = 0;

    if (plan.sequential) {
      // Run workers one at a time
      for (const task of plan.workers) {
        if (opts.abortSignal?.aborted) break;

        const result = await this.workerAgent.execute({
          task,
          cwd: opts.cwd,
          abortSignal: opts.abortSignal,
          onInvocation: opts.onInvocation,
        });

        workerResults.push(result);
        completedCount++;
        sendStatus({
          type: "status",
          message: `Completed: ${task.description}`,
          progress: `${completedCount}/${plan.workers.length} tasks`,
        });
      }
    } else {
      // Run workers with dependency tracking
      const completed = new Set<string>();
      const resultMap = new Map<string, WorkerResult>();
      const remaining = new Set(plan.workers.map((w) => w.id));

      while (remaining.size > 0) {
        if (opts.abortSignal?.aborted) break;

        // Find tasks whose dependencies are all satisfied
        const ready = plan.workers.filter(
          (w) => remaining.has(w.id) && (w.dependsOn || []).every((dep) => completed.has(dep))
        );

        if (ready.length === 0) {
          // Deadlock — no tasks can proceed
          logger.error({ remaining: [...remaining] }, "Worker dependency deadlock");
          break;
        }

        // Run all ready tasks in parallel
        const results = await Promise.all(
          ready.map((task) =>
            this.workerAgent.execute({
              task,
              cwd: opts.cwd,
              abortSignal: opts.abortSignal,
              onInvocation: opts.onInvocation,
            })
          )
        );

        for (let i = 0; i < ready.length; i++) {
          const task = ready[i];
          const result = results[i];
          workerResults.push(result);
          resultMap.set(task.id, result);
          completed.add(task.id);
          remaining.delete(task.id);
          completedCount++;
        }

        sendStatus({
          type: "status",
          message: `Completed ${completedCount} of ${plan.workers.length} tasks`,
          progress: `${completedCount}/${plan.workers.length} tasks`,
        });
      }
    }

    // Phase 3: Summary — feed results back to orchestrator
    const totalCostUsd =
      (planResult.costUsd || 0) +
      workerResults.reduce((sum, r) => sum + (r.costUsd || 0), 0);

    const summaryPrompt = [
      `All workers have completed. Here are the results:`,
      ``,
      ...workerResults.map((r) =>
        [
          `--- Worker: ${r.taskId} ---`,
          `Success: ${r.success}`,
          `Duration: ${r.duration ? Math.round(r.duration / 1000) + "s" : "unknown"}`,
          `Result: ${r.result.slice(0, 2000)}`, // Truncate long results
          ``,
        ].join("\n")
      ),
      ``,
      `Total cost so far: $${totalCostUsd.toFixed(4)}`,
      ``,
      `Provide a concise summary of what was accomplished, any failures, and any follow-up needed.`,
      `Respond in plain text (not JSON).`,
    ].join("\n");

    sendStatus({ type: "status", message: "Summarizing results..." });

    let summaryText = `${completedCount}/${plan.workers.length} tasks completed.`;
    let summaryCost = 0;

    try {
      // Summary phase: stateless, no tools needed — just summarizing text
      const summaryResult = await invokeClaude({
        prompt: summaryPrompt,
        cwd: opts.cwd,
        sessionId: undefined, // No session for summary — stateless
        abortSignal: opts.abortSignal,
        config: this.config,
        onInvocation: opts.onInvocation,
        systemPrompt: "You are a task orchestrator. Summarize the worker results concisely. No personality. Plain text only.",
        model: tierConfig.model,
        maxTurnsOverride: 1, // Summary is a single turn — just output text
        timeoutMsOverride: 30000,
        allowedTools: "", // No tools needed for summarization
      });

      summaryText = summaryResult.result;
      summaryCost = summaryResult.costUsd || 0;
    } catch (err: any) {
      logger.error({ err }, "Orchestrator summary phase failed");
      // Fall back to a basic summary
      const successes = workerResults.filter((r) => r.success).length;
      const failures = workerResults.filter((r) => !r.success).length;
      summaryText = `Completed ${successes} task(s) successfully${failures > 0 ? `, ${failures} failed` : ""}. Total cost: $${totalCostUsd.toFixed(4)}.`;
    }

    const overallSuccess = workerResults.every((r) => r.success);

    logger.info({
      chatId: opts.chatId,
      overallSuccess,
      workerCount: workerResults.length,
      totalCostUsd: totalCostUsd + summaryCost,
    }, "Orchestrator complete");

    return {
      type: "summary",
      overallSuccess,
      summary: summaryText,
      workerResults,
      totalCostUsd: totalCostUsd + summaryCost,
    };
  }
}

function parsePlan(raw: string): OrchestratorPlan {
  let text = raw.trim();

  // Strategy 1: Try parsing the entire response as JSON (ideal case)
  try {
    const plan = JSON.parse(text) as OrchestratorPlan;
    return validatePlan(plan);
  } catch {
    // Not pure JSON — try extraction strategies
  }

  // Strategy 2: Strip markdown code fences (```json ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    try {
      const plan = JSON.parse(fenceMatch[1].trim()) as OrchestratorPlan;
      return validatePlan(plan);
    } catch {
      // Fenced content wasn't valid JSON
    }
  }

  // Strategy 3: Find JSON object containing "type":"plan" in mixed prose
  // This handles cases like "Here's the plan:\n{...}" or "Done! {...}"
  const planTypeIndex = text.indexOf('"type"');
  if (planTypeIndex !== -1) {
    // Walk backwards from "type" to find the opening brace
    let braceStart = text.lastIndexOf("{", planTypeIndex);
    if (braceStart !== -1) {
      // Now find the matching closing brace
      let depth = 0;
      for (let i = braceStart; i < text.length; i++) {
        if (text[i] === "{") depth++;
        if (text[i] === "}") depth--;
        if (depth === 0) {
          const candidate = text.slice(braceStart, i + 1);
          try {
            const plan = JSON.parse(candidate) as OrchestratorPlan;
            return validatePlan(plan);
          } catch {
            // This brace pair didn't contain valid JSON, continue
            break;
          }
        }
      }
    }
  }

  // Strategy 4: Last resort — find the largest JSON object in the text
  const lastClose = text.lastIndexOf("}");
  if (lastClose !== -1) {
    let depth = 0;
    let start = -1;
    for (let i = lastClose; i >= 0; i--) {
      if (text[i] === "}") depth++;
      if (text[i] === "{") depth--;
      if (depth === 0) {
        start = i;
        break;
      }
    }
    if (start !== -1) {
      const candidate = text.slice(start, lastClose + 1);
      try {
        const plan = JSON.parse(candidate) as OrchestratorPlan;
        return validatePlan(plan);
      } catch {
        // Last resort failed
      }
    }
  }

  throw new Error(
    `Could not extract JSON plan from orchestrator output. Raw output starts with: "${text.slice(0, 100)}..."`
  );
}

function validatePlan(plan: OrchestratorPlan): OrchestratorPlan {
  if (plan.type !== "plan" || !Array.isArray(plan.workers)) {
    throw new Error("Invalid plan: missing type or workers array");
  }

  for (const worker of plan.workers) {
    if (!worker.id || !worker.prompt) {
      throw new Error(`Invalid worker task: missing id or prompt`);
    }
  }

  return plan;
}
