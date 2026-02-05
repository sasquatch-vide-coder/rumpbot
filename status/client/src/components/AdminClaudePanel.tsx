import { useState, useEffect } from "react";
import { getClaudeStatus } from "../lib/adminApi";

interface Props {
  token: string;
}

export function AdminClaudePanel({ token }: Props) {
  const [status, setStatus] = useState<{
    installed: boolean;
    version: string | null;
    authenticated: boolean;
    path: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    getClaudeStatus(token)
      .then(setStatus)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <h2 className="text-lg font-bold uppercase mb-4 border-b-3 border-brutal-black pb-2">
        Claude Code
      </h2>

      {loading && <p className="font-mono text-sm">Checking status...</p>}
      {error && <p className="font-mono text-sm text-brutal-red">{error}</p>}

      {status && (
        <div className="space-y-3 font-mono text-sm">
          <div className="flex justify-between">
            <span className="uppercase font-bold">Installed</span>
            <span
              className={`px-2 py-0.5 font-bold ${
                status.installed
                  ? "bg-brutal-green text-brutal-black"
                  : "bg-brutal-red text-brutal-white"
              }`}
            >
              {status.installed ? "YES" : "NO"}
            </span>
          </div>
          {status.version && (
            <div className="flex justify-between">
              <span className="uppercase font-bold">Version</span>
              <span>{status.version}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="uppercase font-bold">Authenticated</span>
            <span
              className={`px-2 py-0.5 font-bold ${
                status.authenticated
                  ? "bg-brutal-green text-brutal-black"
                  : "bg-brutal-red text-brutal-white"
              }`}
            >
              {status.authenticated ? "YES" : "NO"}
            </span>
          </div>
          {status.path && (
            <div className="flex justify-between">
              <span className="uppercase font-bold">Path</span>
              <span className="text-xs">{status.path}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
