import { useState, useEffect, useRef } from "react";

interface AgentEntry {
  id: string;
  role: "executor";
  chatId: number;
  description: string;
  phase: string;
  startedAt: number;
  lastActivityAt: number;
  completedAt?: number;
  success?: boolean;
  costUsd?: number;
  progress?: string;
  recentOutput: string[];
}

interface RegistrySnapshot {
  agents: AgentEntry[];
  recentlyCompleted: AgentEntry[];
  timestamp: number;
}

export function AgentsPanel({ token }: { token: string }) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [recentlyCompleted, setRecentlyCompleted] = useState<AgentEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, setTick] = useState(0); // Force re-render for elapsed time

  useEffect(() => {
    // Connect to SSE stream with fetch-based approach (supports auth headers)
    const controller = new AbortController();
    abortRef.current = controller;
    connectSSE(token, setAgents, setRecentlyCompleted, setConnected, controller);

    // Tick every second to update elapsed times
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      controller.abort();
      abortRef.current = null;
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [token]);

  const activeAgents = agents.filter(
    (a) => a.phase !== "completed" && a.phase !== "failed"
  );
  const finishedAgents = agents.filter(
    (a) => a.phase === "completed" || a.phase === "failed"
  );

  return (
    <div className="space-y-6">
      {/* Active Agents */}
      <div className="bg-brutal-white brutal-border brutal-shadow p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold uppercase font-mono">
            Active Agents
          </h2>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connected ? "bg-brutal-green animate-pulse" : "bg-brutal-red"
              }`}
            />
            <span className="text-xs font-mono uppercase text-brutal-black/50">
              {connected ? "Live" : "Disconnected"}
            </span>
          </div>
        </div>

        {activeAgents.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-brutal-black/30 font-mono text-sm uppercase">
              No agents running
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                expanded={expandedAgent === agent.id}
                onToggle={() =>
                  setExpandedAgent(
                    expandedAgent === agent.id ? null : agent.id
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Recently Finished */}
      {(finishedAgents.length > 0 || recentlyCompleted.length > 0) && (
        <div className="bg-brutal-white brutal-border brutal-shadow p-4 md:p-6">
          <h2 className="text-lg font-bold uppercase font-mono mb-4">
            Recent History
          </h2>
          <div className="space-y-2">
            {[...finishedAgents, ...recentlyCompleted]
              .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
              .slice(0, 20)
              .map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  expanded={expandedAgent === agent.id}
                  onToggle={() =>
                    setExpandedAgent(
                      expandedAgent === agent.id ? null : agent.id
                    )
                  }
                  compact
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  expanded,
  onToggle,
  compact,
}: {
  agent: AgentEntry;
  expanded: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const elapsed = agent.completedAt
    ? agent.completedAt - agent.startedAt
    : Date.now() - agent.startedAt;

  const isActive = agent.phase !== "completed" && agent.phase !== "failed";
  const timeSinceActivity = Date.now() - agent.lastActivityAt;
  const isStale = isActive && timeSinceActivity > 60000;

  const phaseColors: Record<string, string> = {
    executing: "bg-brutal-blue text-brutal-white",
    completed: "bg-brutal-green text-brutal-white",
    failed: "bg-brutal-red text-brutal-white",
  };

  const roleIcon = agent.role === "executor" ? "⚡" : "⚙️";

  return (
    <div
      className={`brutal-border ${
        compact ? "p-2 md:p-3" : "p-3 md:p-4"
      } ${isActive ? "bg-brutal-bg" : ""} cursor-pointer hover:bg-brutal-bg/50 transition-colors`}
      onClick={onToggle}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm flex-shrink-0">{roleIcon}</span>
          <span
            className={`text-[10px] font-bold uppercase px-2 py-0.5 font-mono flex-shrink-0 ${
              phaseColors[agent.phase] || "bg-brutal-black/10"
            }`}
          >
            {agent.phase}
          </span>
          <span className="font-mono text-xs md:text-sm truncate min-w-0">
            {agent.description}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {agent.progress && (
            <span className="text-[10px] font-mono text-brutal-black/50 uppercase">
              {agent.progress}
            </span>
          )}
          <span
            className={`font-mono text-xs font-bold ${
              isStale ? "text-brutal-orange" : "text-brutal-black/60"
            }`}
          >
            {formatElapsed(elapsed)}
          </span>
          {agent.costUsd !== undefined && (
            <span className="font-mono text-xs text-brutal-black/40">
              ${agent.costUsd.toFixed(4)}
            </span>
          )}
          <span className="text-brutal-black/30 text-xs">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Activity indicator for active agents */}
      {isActive && !compact && (
        <div className="mt-2 flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              isStale
                ? "bg-brutal-orange"
                : "bg-brutal-green animate-pulse"
            }`}
          />
          <span className="text-[10px] font-mono text-brutal-black/40 uppercase">
            {isStale
              ? `Silent for ${formatElapsed(timeSinceActivity)}`
              : "Active"}
          </span>
        </div>
      )}

      {/* Expanded: Recent Output */}
      {expanded && agent.recentOutput.length > 0 && (
        <div className="mt-3 bg-brutal-black text-brutal-green font-mono text-[11px] p-3 brutal-border max-h-[300px] overflow-y-auto">
          {agent.recentOutput.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
              {line}
            </div>
          ))}
        </div>
      )}

      {expanded && agent.recentOutput.length === 0 && (
        <div className="mt-3 text-xs font-mono text-brutal-black/30 italic">
          No output captured yet
        </div>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60)
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

// Fetch-based SSE with auth header support
function connectSSE(
  token: string,
  setAgents: React.Dispatch<React.SetStateAction<AgentEntry[]>>,
  setRecentlyCompleted: React.Dispatch<React.SetStateAction<AgentEntry[]>>,
  setConnected: React.Dispatch<React.SetStateAction<boolean>>,
  controller: AbortController,
) {
  const { signal } = controller;

  const connect = async () => {
    try {
      const res = await fetch("/api/agents/stream", {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });

      if (!res.ok || !res.body) {
        setConnected(false);
        // Retry after delay
        if (!signal.aborted) setTimeout(connect, 5000);
        return;
      }

      setConnected(true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let watchdog: ReturnType<typeof setInterval> | null = null;

      try {
        // Ping watchdog: if no data received in 45s, cancel the reader
        // (NOT the main controller — that would permanently kill reconnection)
        let lastDataTime = Date.now();
        watchdog = setInterval(() => {
          if (Date.now() - lastDataTime > 45000) {
            reader.cancel();
          }
        }, 45000);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lastDataTime = Date.now();
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));
                handleSSEEvent(
                  currentEvent,
                  data,
                  setAgents,
                  setRecentlyCompleted,
                );
              } catch {
                // Ignore parse errors
              }
              currentEvent = "";
            }
          }
        }
      } finally {
        if (watchdog) clearInterval(watchdog);
        reader.releaseLock();
      }
    } catch (err) {
      // AbortError from the main controller means React cleanup — don't reconnect
      if (signal.aborted) return;
      setConnected(false);
    }

    // Reconnect unless aborted
    if (!signal.aborted) {
      setConnected(false);
      setTimeout(connect, 3000);
    }
  };

  connect();
}

function handleSSEEvent(
  eventType: string,
  data: any,
  setAgents: React.Dispatch<React.SetStateAction<AgentEntry[]>>,
  setRecentlyCompleted: React.Dispatch<React.SetStateAction<AgentEntry[]>>,
) {
  if (eventType === "snapshot") {
    const snapshot = data as RegistrySnapshot;
    setAgents(snapshot.agents);
    setRecentlyCompleted(snapshot.recentlyCompleted);
    return;
  }

  // All other events carry a RegistryEvent with an agent field
  const agent = data.agent as AgentEntry | undefined;
  if (!agent) return;

  switch (eventType) {
    case "agent-registered":
      setAgents((prev) => [...prev, agent]);
      break;

    case "agent-updated":
    case "agent-output":
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? agent : a))
      );
      break;

    case "agent-completed":
    case "agent-failed":
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? agent : a))
      );
      setRecentlyCompleted((prev) => [agent, ...prev].slice(0, 50));
      break;

    case "agent-removed":
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      break;
  }
}
