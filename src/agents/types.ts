export type AgentTier = "chat" | "orchestrator" | "worker";

export interface WorkRequest {
  type: "work_request";
  task: string;
  context: string;
  urgency: "normal" | "quick";
}

export interface OrchestratorPlan {
  type: "plan";
  summary: string;
  workers: WorkerTask[];
  sequential: boolean;
}

export interface WorkerTask {
  id: string;
  description: string;
  prompt: string;
  dependsOn?: string[];
}

export interface WorkerResult {
  taskId: string;
  success: boolean;
  result: string;
  costUsd?: number;
  duration?: number;
}

export interface OrchestratorSummary {
  type: "summary";
  overallSuccess: boolean;
  summary: string;
  workerResults: WorkerResult[];
  totalCostUsd: number;
}

export interface StatusUpdate {
  type: "status" | "plan_breakdown" | "worker_complete";
  message: string;
  progress?: string;
}

export interface ChatAgentResponse {
  chatText: string;
  action: WorkRequest | null;
}
