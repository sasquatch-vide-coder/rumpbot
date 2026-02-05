import { useState, useEffect } from "react";
import { getTelegramStatus } from "../lib/adminApi";

interface Props {
  token: string;
}

export function AdminTelegramPanel({ token }: Props) {
  const [status, setStatus] = useState<{
    configured: boolean;
    botRunning: boolean;
    allowedUserCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    getTelegramStatus(token)
      .then(setStatus)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <h2 className="text-lg font-bold uppercase mb-4 border-b-3 border-brutal-black pb-2">
        Telegram Bot
      </h2>

      {loading && <p className="font-mono text-sm">Checking status...</p>}
      {error && <p className="font-mono text-sm text-brutal-red">{error}</p>}

      {status && (
        <div className="space-y-3 font-mono text-sm">
          <div className="flex justify-between">
            <span className="uppercase font-bold">Configured</span>
            <span
              className={`px-2 py-0.5 font-bold ${
                status.configured
                  ? "bg-brutal-green text-brutal-black"
                  : "bg-brutal-red text-brutal-white"
              }`}
            >
              {status.configured ? "YES" : "NO"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="uppercase font-bold">Bot Running</span>
            <span
              className={`px-2 py-0.5 font-bold ${
                status.botRunning
                  ? "bg-brutal-green text-brutal-black"
                  : "bg-brutal-red text-brutal-white"
              }`}
            >
              {status.botRunning ? "YES" : "NO"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="uppercase font-bold">Allowed Users</span>
            <span className="font-bold">{status.allowedUserCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
