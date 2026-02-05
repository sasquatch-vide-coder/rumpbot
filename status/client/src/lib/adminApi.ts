const API_BASE = "/api/admin";

async function request<T = Record<string, unknown>>(
  path: string,
  options?: RequestInit & { token?: string }
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }
  if (options?.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }
  const { token: _, ...fetchOpts } = options || {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOpts,
    headers: { ...headers, ...fetchOpts?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as Record<string, string>).error || "Request failed");
  }
  return res.json() as Promise<T>;
}

// Auth
export function getSetupStatus() {
  return request<{ isSetUp: boolean; mfaEnabled: boolean }>("/setup-status");
}

export function setup(username: string, password: string) {
  return request<{ ok: boolean; token: string }>("/setup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function login(username: string, password: string) {
  return request<{ ok: boolean; requireMfa: boolean; token: string }>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function verifyMfa(code: string, token: string) {
  return request<{ ok: boolean; token: string }>("/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
    token,
  });
}

// Protected endpoints
export function getClaudeStatus(token: string) {
  return request<{
    installed: boolean;
    version: string | null;
    authenticated: boolean;
    path: string | null;
    subscriptionType: string | null;
    rateLimitTier: string | null;
    credentialsExist: boolean;
    tokenExpiresAt: number | null;
    setupCommand: string;
  }>("/claude/status", { token });
}

export function checkClaudeUpdate(token: string) {
  return request<{
    currentVersion: string | null;
    updateAvailable: boolean;
    upToDate: boolean;
    output: string;
  }>("/claude/check-update", { token });
}

export function installClaudeUpdate(token: string) {
  return request<{ ok: boolean; output: string }>("/claude/update", {
    method: "POST",
    token,
  });
}

export function getTelegramStatus(token: string) {
  return request<{
    configured: boolean;
    botRunning: boolean;
    botToken: string;
    allowedUserIds: string[];
    allowedUserCount: number;
  }>("/telegram/status", { token });
}

export function updateTelegramConfig(
  config: { botToken?: string; allowedUserIds?: string[] },
  token: string
) {
  return request<{ ok: boolean; restartRequired: boolean }>(
    "/telegram/config",
    {
      method: "POST",
      body: JSON.stringify(config),
      token,
    }
  );
}

export function restartService(token: string) {
  return request<{ ok: boolean; output: string }>("/service/restart", {
    method: "POST",
    token,
  });
}

export function getSSLStatus(token: string) {
  return request<{
    hasCert: boolean;
    domain: string | null;
    expiry: string | null;
    certPath: string | null;
    autoRenew: boolean;
  }>("/ssl/status", { token });
}

export function renewSSL(token: string) {
  return request<{ ok: boolean; output: string }>("/ssl/renew", {
    method: "POST",
    token,
  });
}

export function generateSSLCert(domain: string, token: string) {
  return request<{ ok: boolean; output: string; domain?: string }>("/ssl/generate", {
    method: "POST",
    body: JSON.stringify({ domain }),
    token,
  });
}

export function getMfaSetup(token: string) {
  return request<{ secret: string; uri: string; qrCode: string }>(
    "/mfa/setup",
    { token }
  );
}

export function enableMfa(code: string, token: string) {
  return request<{ ok: boolean }>("/mfa/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
    token,
  });
}

export function disableMfa(token: string) {
  return request<{ ok: boolean }>("/mfa/disable", {
    method: "POST",
    token,
  });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
  token: string
) {
  return request<{ ok: boolean }>("/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
    token,
  });
}

// Agent Config
export interface AgentTierConfig {
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface AgentConfigData {
  chat: AgentTierConfig;
  orchestrator: AgentTierConfig;
  worker: AgentTierConfig;
}

export function getAgentConfig(token: string) {
  return request<AgentConfigData>("/agents/config", { token });
}

export function updateAgentConfig(
  config: Partial<{
    chat: Partial<AgentTierConfig>;
    orchestrator: Partial<AgentTierConfig>;
    worker: Partial<AgentTierConfig>;
  }>,
  token: string
) {
  return request<{ ok: boolean; config: AgentConfigData }>("/agents/config", {
    method: "POST",
    body: JSON.stringify(config),
    token,
  });
}

// Chat
export interface ChatSSEEvent {
  type: "status" | "chat_response" | "work_complete" | "error" | "done";
  data: any;
}

export function sendChatMessage(
  message: string,
  token: string,
  onEvent: (event: ChatSSEEvent) => void
): { abort: () => void } {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        onEvent({
          type: "error",
          data: { message: (err as Record<string, string>).error || "Request failed" },
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onEvent({ type: "error", data: { message: "No response stream" } });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from the buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent({ type: currentEvent as ChatSSEEvent["type"], data });
            } catch {
              // Ignore parse errors
            }
            currentEvent = "";
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        onEvent({
          type: "error",
          data: { message: err.message || "Connection failed" },
        });
      }
    }
  })();

  return {
    abort: () => controller.abort(),
  };
}

// Bot Config
export function getBotConfig(token: string) {
  return request<{ botName: string }>("/bot/config", { token });
}

export function updateBotConfig(config: { botName: string }, token: string) {
  return request<{ ok: boolean; botName: string }>("/bot/config", {
    method: "POST",
    body: JSON.stringify(config),
    token,
  });
}

export function resetChatSession(token: string) {
  return request<{ ok: boolean }>("/chat/reset", {
    method: "POST",
    token,
  });
}

export interface ChatHistoryMessage {
  id: string;
  role: "user" | "assistant" | "status" | "work_result";
  text: string;
  timestamp: number;
  phase?: string;
  workMeta?: {
    overallSuccess: boolean;
    totalCostUsd: number;
    workerCount: number;
  };
}

export function getChatHistory(token: string) {
  return request<{ messages: ChatHistoryMessage[] }>("/chat/history", {
    method: "GET",
    token,
  });
}
