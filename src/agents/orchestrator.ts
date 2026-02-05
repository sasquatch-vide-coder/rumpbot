import { Config } from "../config.js";
import { invokeClaude } from "../claude/invoker.js";
import { SessionManager } from "../claude/session-manager.js";
import { AgentConfigManager } from "./agent-config.js";
import { WorkerAgent } from "./worker.js";
import { AgentRegistry, agentRegistry as defaultRegistry } from "./agent-registry.js";
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
const STATUS_UPDATE_INTERVAL_MS = 5000; // Rate-limit status updates to 1 per 5s
const HEARTBEAT_INTERVAL_MS = 60000; // 60 seconds between heartbeats
const STALL_WARNING_MS = 120000; // 2 minutes of no output = stall warning

export class Orchestrator {
  private workerAgent: WorkerAgent;
  private registry: AgentRegistry;

  // Active orchestration state for /kill and /retry support
  _activeRetryFn: ((workerNumber: number) => Promise<WorkerResult | null>) | null = null;
  _activeOrchId: string | null = null;

  constructor(
    private config: Config,
    private agentConfig: AgentConfigManager,
    private sessionManager: SessionManager,
    registry?: AgentRegistry,
  ) {
    this.workerAgent = new WorkerAgent(config, agentConfig);
    this.registry = registry || defaultRegistry;
  }

  getRegistry(): AgentRegistry {
    return this.registry;
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

    // Register orchestrator in the agent registry
    const orchId = this.registry.register({
      role: "orchestrator",
      chatId: opts.chatId,
      description: opts.workRequest.task,
      phase: "planning",
    });

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
      this.registry.complete(orchId, false, planResult.costUsd);
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

    // Update orchestrator registry — plan created, moving to execution
    this.registry.update(orchId, {
      phase: "executing",
      progress: `0/${plan.workers.length} tasks`,
      description: `${opts.workRequest.task} — ${plan.summary}`,
    });

    // Send full plan breakdown to user
    const modeIcon = plan.sequential ? "⏬" : "⏩";
    const modeLabel = plan.sequential ? "Sequential" : "Parallel";
    const planBreakdown = [
      `📋 *Plan:* ${plan.summary}`,
      ``,
      `${modeIcon} *Mode:* ${modeLabel}`,
      ``,
      ...plan.workers.map((w, i) => {
        const deps = w.dependsOn?.length ? ` (after: ${w.dependsOn.join(", ")})` : "";
        return `🔧 *${i + 1}.* ${w.description}${deps}`;
      }),
      ``,
      `📊 ${plan.workers.length} worker(s) total`,
    ].join("\n");

    // Force-send plan breakdown (bypass rate limiter)
    opts.onStatusUpdate?.({
      type: "plan_breakdown",
      message: planBreakdown,
      progress: `0/${plan.workers.length} tasks`,
    });

    sendStatus({
      type: "status",
      message: `Plan: ${plan.summary}`,
      progress: `0/${plan.workers.length} tasks`,
    });

    // Phase 2: Execute workers
    const workerResults: WorkerResult[] = [];
    let completedCount = 0;
    const totalWorkers = plan.workers.length;

    // Helper: truncate result output to ~10 lines for status summaries
    const truncateResult = (text: string, maxLines = 10): string => {
      const lines = text.split("\n");
      if (lines.length <= maxLines) return text;
      return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
    };

    // Helper: run a single worker with heartbeat + stall detection + registry tracking
    const executeWithMonitoring = (task: WorkerTask, workerNumber: number): Promise<WorkerResult> => {
      return new Promise((resolve) => {
        const startTime = Date.now();
        let lastActivityTime = Date.now();
        let stallWarned = false;

        // Create a per-worker AbortController linked to the main one
        const workerAbort = new AbortController();

        // If the main orchestration signal aborts, abort this worker too
        const onMainAbort = () => workerAbort.abort();
        if (opts.abortSignal) {
          if (opts.abortSignal.aborted) {
            workerAbort.abort();
          } else {
            opts.abortSignal.addEventListener("abort", onMainAbort, { once: true });
          }
        }

        // Register worker in registry
        const workerId = this.registry.register({
          role: "worker",
          chatId: opts.chatId,
          description: task.description,
          phase: "executing",
          parentId: orchId,
        });

        // Store the worker's AbortController in the registry for /kill support
        this.registry.setWorkerAbortController(orchId, workerId, {
          controller: workerAbort,
          taskPrompt: task.prompt,
          taskDescription: task.description,
          workerNumber,
        });

        // Heartbeat: every 60s, update the user that the worker is still running
        const heartbeat = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const elapsedStr = formatDuration(elapsed);
          // Update registry with activity
          this.registry.update(workerId, { lastActivityAt: Date.now() });
          // Force-send (bypass rate limiter) for heartbeats
          opts.onStatusUpdate?.({
            type: "status",
            message: `⏳ Worker "${task.description}" still running (${elapsedStr} elapsed)`,
            progress: `${completedCount}/${totalWorkers} tasks done`,
          });
        }, HEARTBEAT_INTERVAL_MS);

        // Stall detection: check every 30s if output has gone silent
        const stallCheck = setInterval(() => {
          const silentFor = Date.now() - lastActivityTime;
          if (silentFor >= STALL_WARNING_MS && !stallWarned) {
            stallWarned = true;
            const silentMin = Math.round(silentFor / 60000);
            opts.onStatusUpdate?.({
              type: "status",
              message: `⚠️ Worker "${task.description}" has been silent for ${silentMin} minutes — may be stalled`,
              progress: `${completedCount}/${totalWorkers} tasks done`,
            });
            logger.warn({ taskId: task.id, silentForMs: silentFor }, "Worker may be stalled");
          }
        }, 30000);

        // Activity tracker — called by invoker whenever stdout/stderr produces output
        const onActivity = () => {
          lastActivityTime = Date.now();
          this.registry.update(workerId, { lastActivityAt: Date.now() });
          if (stallWarned) {
            stallWarned = false; // Reset stall warning if activity resumes
            opts.onStatusUpdate?.({
              type: "status",
              message: `Worker "${task.description}" is active again`,
              progress: `${completedCount}/${totalWorkers} tasks done`,
            });
          }
        };

        // Output tracker — feeds raw output chunks to the agent registry
        const onOutput = (chunk: string) => {
          this.registry.addOutput(workerId, chunk);
        };

        this.workerAgent
          .execute({
            task,
            cwd: opts.cwd,
            abortSignal: workerAbort.signal,
            onInvocation: opts.onInvocation,
            onActivity,
            onOutput,
          })
          .then((result) => {
            clearInterval(heartbeat);
            clearInterval(stallCheck);
            opts.abortSignal?.removeEventListener("abort", onMainAbort);
            this.registry.complete(workerId, result.success, result.costUsd);
            this.registry.removeWorkerAbortController(orchId, workerId);
            resolve(result);
          })
          .catch((err) => {
            clearInterval(heartbeat);
            clearInterval(stallCheck);
            opts.abortSignal?.removeEventListener("abort", onMainAbort);
            const wasKilled = workerAbort.signal.aborted && !opts.abortSignal?.aborted;
            this.registry.complete(workerId, false);
            // Don't remove the abort info so /retry can look it up
            resolve({
              taskId: task.id,
              success: false,
              result: wasKilled ? "Worker killed by user" : `Worker error: ${err.message}`,
              duration: Date.now() - startTime,
            });
          });
      });
    };

    // Retry method: re-run a specific worker by its worker number
    const retryWorker = async (workerNumber: number): Promise<WorkerResult | null> => {
      // Find the worker info in the registry
      const workerInfo = this.registry.getWorkerByNumber(orchId, workerNumber);
      if (!workerInfo) return null;

      const task: WorkerTask = {
        id: `retry-${workerInfo.info.workerNumber}-${Date.now()}`,
        description: workerInfo.info.taskDescription,
        prompt: workerInfo.info.taskPrompt,
      };

      // Remove the old abort controller entry
      this.registry.removeWorkerAbortController(orchId, workerInfo.workerId);

      const result = await executeWithMonitoring(task, workerNumber);
      return result;
    };

    // Store retryWorker on the orchestrator instance for external access
    this._activeRetryFn = retryWorker;
    this._activeOrchId = orchId;

    if (plan.sequential) {
      // Run workers one at a time
      for (let idx = 0; idx < plan.workers.length; idx++) {
        const task = plan.workers[idx];
        const workerNumber = idx + 1;
        if (opts.abortSignal?.aborted) break;

        sendStatus({
          type: "status",
          message: `Starting: ${task.description}`,
          progress: `${completedCount}/${totalWorkers} tasks done`,
        });

        const result = await executeWithMonitoring(task, workerNumber);

        workerResults.push(result);
        completedCount++;

        // Update orchestrator progress in registry
        this.registry.update(orchId, { progress: `${completedCount}/${totalWorkers} tasks` });

        // Immediate per-worker completion update with result summary
        const statusIcon = result.success ? "✅" : "❌";
        const durationStr = result.duration ? ` (${formatDuration(result.duration)})` : "";
        const resultSummary = truncateResult(result.result);
        opts.onStatusUpdate?.({
          type: "worker_complete",
          message: `${statusIcon} ${result.success ? "Done" : "Failed"}: ${task.description}${durationStr}\n\n${resultSummary}`,
          progress: `${completedCount}/${totalWorkers} tasks done`,
        });
      }
    } else {
      // Run workers with dependency tracking
      const completed = new Set<string>();
      const resultMap = new Map<string, WorkerResult>();
      const remaining = new Set(plan.workers.map((w) => w.id));

      // Build a worker number lookup
      const workerNumberMap = new Map<string, number>();
      plan.workers.forEach((w, i) => workerNumberMap.set(w.id, i + 1));

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

        // Announce starting workers
        const names = ready.map((t) => t.description).join(", ");
        sendStatus({
          type: "status",
          message: `Starting ${ready.length} worker(s): ${names}`,
          progress: `${completedCount}/${totalWorkers} tasks done`,
        });

        // Run all ready tasks in parallel with monitoring
        const results = await Promise.all(
          ready.map((task) => executeWithMonitoring(task, workerNumberMap.get(task.id)!))
        );

        for (let i = 0; i < ready.length; i++) {
          const task = ready[i];
          const result = results[i];
          workerResults.push(result);
          resultMap.set(task.id, result);
          completed.add(task.id);
          remaining.delete(task.id);
          completedCount++;

          // Update orchestrator progress in registry
          this.registry.update(orchId, { progress: `${completedCount}/${totalWorkers} tasks` });

          // Immediate per-worker completion update with result summary
          const statusIcon = result.success ? "✅" : "❌";
          const durationStr = result.duration ? ` (${formatDuration(result.duration)})` : "";
          const resultSummary = truncateResult(result.result);
          opts.onStatusUpdate?.({
            type: "worker_complete",
            message: `${statusIcon} ${result.success ? "Done" : "Failed"}: ${task.description}${durationStr}\n\n${resultSummary}`,
            progress: `${completedCount}/${totalWorkers} tasks done`,
          });
        }
      }
    }

    // Phase 3: Summary — update registry to summarizing phase
    this.registry.update(orchId, { phase: "summarizing" });

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
    const finalCost = totalCostUsd + summaryCost;

    // Mark orchestrator complete in registry
    this.registry.complete(orchId, overallSuccess, finalCost);

    // Clean up worker AbortControllers
    this.registry.clearWorkerAbortControllers(orchId);
    this._activeRetryFn = null;
    this._activeOrchId = null;

    logger.info({
      chatId: opts.chatId,
      overallSuccess,
      workerCount: workerResults.length,
      totalCostUsd: finalCost,
    }, "Orchestrator complete");

    return {
      type: "summary",
      overallSuccess,
      summary: summaryText,
      workerResults,
      totalCostUsd: finalCost,
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
