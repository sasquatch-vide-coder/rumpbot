export type AgentTier = "chat" | "executor";

export interface WorkRequest {
  type: "work_request";
  task: string;
  context: string;
  urgency: "normal" | "quick";
  complexity?: "trivial" | "moderate" | "complex";
}

export interface ExecutorResult {
  success: boolean;
  result: string;
  costUsd: number;
  durationMs: number;
  needsRestart: boolean;
}

export interface StatusUpdate {
  type: "status";
  message: string;
  progress?: string;
  /** If true, send as a NEW Telegram message (user gets notification). Otherwise, edit the status message in-place. */
  important?: boolean;
}

export interface ChatAgentResponse {
  chatText: string;
  action: WorkRequest | null;
}
