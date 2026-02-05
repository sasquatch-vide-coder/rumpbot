import { useState, useEffect } from "react";
import { getClaudeStatus } from "../lib/adminApi";

interface Props {
  token: string;
}

interface ClaudeStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  path: string | null;
  subscriptionType: string | null;
  credentialsExist: boolean;
  setupCommand: string;
}

export function AdminClaudePanel({ token }: Props) {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(false);

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

          <div className="flex justify-between">
            <span className="uppercase font-bold">Credentials</span>
            <span
              className={`px-2 py-0.5 font-bold ${
                status.credentialsExist
                  ? "bg-brutal-green text-brutal-black"
                  : "bg-brutal-orange text-brutal-black"
              }`}
            >
              {status.credentialsExist ? "FOUND" : "MISSING"}
            </span>
          </div>

          {status.subscriptionType && (
            <div className="flex justify-between">
              <span className="uppercase font-bold">Plan</span>
              <span className="px-2 py-0.5 font-bold bg-brutal-purple text-brutal-white uppercase">
                {status.subscriptionType}
              </span>
            </div>
          )}

          {status.path && (
            <div className="flex justify-between">
              <span className="uppercase font-bold">Path</span>
              <span className="text-xs">{status.path}</span>
            </div>
          )}

          {/* Setup Guide */}
          {!status.authenticated && (
            <div className="mt-4 border-t-3 border-brutal-black pt-3">
              <button
                onClick={() => setShowSetup(!showSetup)}
                className="w-full bg-brutal-yellow text-brutal-black font-bold uppercase py-2 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-sm"
              >
                {showSetup ? "Hide Setup Guide" : "Setup Guide"}
              </button>

              {showSetup && (
                <div className="mt-3 bg-brutal-bg brutal-border p-4 space-y-3">
                  <p className="font-bold uppercase text-xs">
                    How to authenticate Claude Code:
                  </p>
                  <div className="space-y-2 text-xs">
                    <p>
                      1. SSH into your server:
                    </p>
                    <pre className="bg-brutal-black text-brutal-green p-2 brutal-border overflow-x-auto">
                      ssh ubuntu@your-server-ip
                    </pre>
                    <p>
                      2. Run the setup token command:
                    </p>
                    <pre className="bg-brutal-black text-brutal-green p-2 brutal-border overflow-x-auto">
                      {status.setupCommand}
                    </pre>
                    <p>
                      3. Follow the prompts to authenticate with your Anthropic account.
                    </p>
                    <p>
                      4. Once complete, restart the bot service:
                    </p>
                    <pre className="bg-brutal-black text-brutal-green p-2 brutal-border overflow-x-auto">
                      sudo systemctl restart rumpbot
                    </pre>
                    <p className="text-brutal-black/60 italic">
                      Note: Claude Code authentication requires terminal access
                      and cannot be done through this web interface.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
