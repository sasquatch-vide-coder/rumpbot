import { useState, useEffect, useRef, useCallback } from "react";

interface ServiceStatus {
  status: string;
  uptime: string | null;
  pid: number | null;
  memory: string | null;
}

interface SystemStatus {
  serverUptime: string;
  loadAvg: number[];
  totalMemMB: number;
  freeMemMB: number;
  diskUsed: string;
  diskTotal: string;
  diskPercent: string;
}

interface Session {
  chatId: string;
  projectDir: string;
  lastUsedAt: number;
}

interface BotStatus {
  sessionCount: number;
  lastActivity: number | null;
  sessions: Session[];
}

interface ProjectsStatus {
  registered: number;
  list: Record<string, string>;
  activeProject: Record<string, string>;
}

export interface StatusData {
  timestamp: number;
  service: ServiceStatus;
  system: SystemStatus;
  bot: BotStatus;
  projects: ProjectsStatus;
}

export function useStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const logsTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setConnected(true);
      setError(null);
      setLoading(false);
    } catch (err: any) {
      setConnected(false);
      setError(err.message);
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/logs?lines=30");
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      // Logs are non-critical
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchLogs();

    statusTimer.current = setInterval(fetchStatus, 3000);
    logsTimer.current = setInterval(fetchLogs, 5000);

    return () => {
      clearInterval(statusTimer.current);
      clearInterval(logsTimer.current);
    };
  }, [fetchStatus, fetchLogs]);

  return { status, logs, loading, error, connected };
}
