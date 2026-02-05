import { EventEmitter } from "events";
import { logger } from "../utils/logger.js";

export type AgentPhase = "planning" | "executing" | "summarizing" | "completed" | "failed";
export type AgentRole = "orchestrator" | "worker";

export interface AgentEntry {
  id: string;
  role: AgentRole;
  chatId: number;
  description: string;
  phase: AgentPhase;
  startedAt: number;
  lastActivityAt: number;
  completedAt?: number;
  parentId?: string; // orchestrator ID for workers
  success?: boolean;
  costUsd?: number;
  progress?: string; // e.g. "2/5 tasks done"
  recentOutput: string[]; // rolling buffer of last N output lines
}

export interface RegistrySnapshot {
  agents: AgentEntry[];
  recentlyCompleted: AgentEntry[];
  timestamp: number;
}

export type RegistryEventType =
  | "agent-registered"
  | "agent-updated"
  | "agent-completed"
  | "agent-failed"
  | "agent-output"
  | "agent-removed";

export interface RegistryEvent {
  type: RegistryEventType;
  agent: AgentEntry;
  timestamp: number;
}

const MAX_OUTPUT_LINES = 30;
const MAX_COMPLETED_HISTORY = 50;
const COMPLETED_TTL_MS = 300_000; // 5 minutes before auto-removal

let nextId = 1;

/**
 * In-memory registry that tracks all active orchestrator and worker agents.
 * Emits events when agents are added, updated, or removed so SSE endpoints
 * can stream live updates to the admin panel.
 */
export interface WorkerAbortInfo {
  controller: AbortController;
  taskPrompt: string;
  taskDescription: string;
  workerNumber: number;
}

export class AgentRegistry extends EventEmitter {
  private agents = new Map<string, AgentEntry>();
  private completedHistory: AgentEntry[] = [];

  // Per-worker AbortControllers: orchestratorId -> (workerId -> WorkerAbortInfo)
  private workerAbortControllers = new Map<string, Map<string, WorkerAbortInfo>>();

  generateId(role: AgentRole): string {
    return `${role}-${nextId++}-${Date.now().toString(36)}`;
  }

  register(entry: Omit<AgentEntry, "id" | "startedAt" | "lastActivityAt" | "recentOutput">): string {
    const id = this.generateId(entry.role);
    const agent: AgentEntry = {
      ...entry,
      id,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      recentOutput: [],
    };
    this.agents.set(id, agent);
    const event: RegistryEvent = { type: "agent-registered", agent: { ...agent }, timestamp: Date.now() };
    this.emit("change", event);
    logger.info({ agentId: id, role: entry.role, description: entry.description, listenerCount: this.listenerCount("change") }, "Agent registered in registry");
    return id;
  }

  update(id: string, updates: Partial<Pick<AgentEntry, "phase" | "progress" | "lastActivityAt" | "success" | "costUsd" | "completedAt" | "description">>): void {
    const agent = this.agents.get(id);
    if (!agent) return;

    Object.assign(agent, updates);
    if (!updates.lastActivityAt) {
      agent.lastActivityAt = Date.now();
    }

    const event: RegistryEvent = { type: "agent-updated", agent: { ...agent, recentOutput: [...agent.recentOutput] }, timestamp: Date.now() };
    this.emit("change", event);
  }

  /**
   * Append output lines to an agent's rolling buffer and emit an output event.
   */
  addOutput(id: string, lines: string | string[]): void {
    const agent = this.agents.get(id);
    if (!agent) return;

    const newLines = Array.isArray(lines) ? lines : lines.split("\n").filter((l) => l.trim());
    agent.recentOutput.push(...newLines);

    // Trim to max
    while (agent.recentOutput.length > MAX_OUTPUT_LINES) {
      agent.recentOutput.shift();
    }

    agent.lastActivityAt = Date.now();

    const event: RegistryEvent = { type: "agent-output", agent: { ...agent, recentOutput: [...agent.recentOutput] }, timestamp: Date.now() };
    this.emit("change", event);
  }

  complete(id: string, success: boolean, costUsd?: number): void {
    const agent = this.agents.get(id);
    if (!agent) return;

    agent.phase = success ? "completed" : "failed";
    agent.success = success;
    agent.completedAt = Date.now();
    agent.lastActivityAt = Date.now();
    if (costUsd !== undefined) agent.costUsd = costUsd;

    const eventType: RegistryEventType = success ? "agent-completed" : "agent-failed";
    const event: RegistryEvent = { type: eventType, agent: { ...agent, recentOutput: [...agent.recentOutput] }, timestamp: Date.now() };
    this.emit("change", event);
    logger.info({ agentId: id, success, costUsd, listenerCount: this.listenerCount("change") }, "Agent completed in registry");

    // Add to rolling history
    this.completedHistory.push({ ...agent, recentOutput: [...agent.recentOutput] });
    while (this.completedHistory.length > MAX_COMPLETED_HISTORY) {
      this.completedHistory.shift();
    }

    // Auto-remove after TTL
    setTimeout(() => {
      if (this.agents.has(id)) {
        this.agents.delete(id);
        const removeEvent: RegistryEvent = { type: "agent-removed", agent: { ...agent }, timestamp: Date.now() };
        this.emit("change", removeEvent);
      }
    }, COMPLETED_TTL_MS);
  }

  get(id: string): AgentEntry | undefined {
    const agent = this.agents.get(id);
    return agent ? { ...agent, recentOutput: [...agent.recentOutput] } : undefined;
  }

  getSnapshot(): RegistrySnapshot {
    return {
      agents: [...this.agents.values()].map((a) => ({ ...a, recentOutput: [...a.recentOutput] })),
      recentlyCompleted: this.completedHistory.map((a) => ({ ...a, recentOutput: [...a.recentOutput] })),
      timestamp: Date.now(),
    };
  }

  getActiveAgents(): AgentEntry[] {
    return [...this.agents.values()]
      .filter((a) => a.phase !== "completed" && a.phase !== "failed")
      .map((a) => ({ ...a, recentOutput: [...a.recentOutput] }));
  }

  getAllAgents(): AgentEntry[] {
    return [...this.agents.values()].map((a) => ({ ...a, recentOutput: [...a.recentOutput] }));
  }

  getCompletedHistory(): AgentEntry[] {
    return this.completedHistory.map((a) => ({ ...a, recentOutput: [...a.recentOutput] }));
  }

  getActiveCount(): number {
    return [...this.agents.values()].filter(
      (a) => a.phase !== "completed" && a.phase !== "failed"
    ).length;
  }

  // --- Per-worker AbortController management ---

  setWorkerAbortController(
    orchestratorId: string,
    workerId: string,
    info: WorkerAbortInfo,
  ): void {
    if (!this.workerAbortControllers.has(orchestratorId)) {
      this.workerAbortControllers.set(orchestratorId, new Map());
    }
    this.workerAbortControllers.get(orchestratorId)!.set(workerId, info);
  }

  getWorkerAbortController(
    orchestratorId: string,
    workerId: string,
  ): WorkerAbortInfo | undefined {
    return this.workerAbortControllers.get(orchestratorId)?.get(workerId);
  }

  removeWorkerAbortController(orchestratorId: string, workerId: string): void {
    this.workerAbortControllers.get(orchestratorId)?.delete(workerId);
  }

  clearWorkerAbortControllers(orchestratorId: string): void {
    this.workerAbortControllers.delete(orchestratorId);
  }

  /**
   * Get all workers for a given orchestrator, with their abort info.
   * Returns a map of workerId -> WorkerAbortInfo.
   */
  getWorkersForOrchestrator(orchestratorId: string): Map<string, WorkerAbortInfo> {
    return this.workerAbortControllers.get(orchestratorId) || new Map();
  }

  /**
   * Find the active orchestrator for a given chatId.
   * Returns the orchestrator agent entry if found.
   */
  getActiveOrchestratorForChat(chatId: number): AgentEntry | undefined {
    return [...this.agents.values()].find(
      (a) => a.role === "orchestrator" && a.chatId === chatId &&
        a.phase !== "completed" && a.phase !== "failed"
    );
  }

  /**
   * Find a worker by its worker number (1-based) within an orchestrator's workers.
   * Returns the workerId and abort info if found.
   */
  getWorkerByNumber(
    orchestratorId: string,
    workerNumber: number,
  ): { workerId: string; info: WorkerAbortInfo } | undefined {
    const workers = this.getWorkersForOrchestrator(orchestratorId);
    for (const [workerId, info] of workers) {
      if (info.workerNumber === workerNumber) {
        return { workerId, info };
      }
    }
    return undefined;
  }
}

/**
 * Singleton agent registry instance shared across the application.
 */
export const agentRegistry = new AgentRegistry();
