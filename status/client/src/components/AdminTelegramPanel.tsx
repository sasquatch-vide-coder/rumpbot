import { useState, useEffect } from "react";
import {
  getTelegramStatus,
  updateTelegramConfig,
  restartService,
} from "../lib/adminApi";

interface Props {
  token: string;
}

interface TelegramStatus {
  configured: boolean;
  botRunning: boolean;
  botToken: string;
  allowedUserIds: string[];
  allowedUserCount: number;
}

export function AdminTelegramPanel({ token }: Props) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editToken, setEditToken] = useState("");
  const [editUserIds, setEditUserIds] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [restarting, setRestarting] = useState(false);

  const fetchStatus = () => {
    setLoading(true);
    getTelegramStatus(token)
      .then((s) => {
        setStatus(s);
        setEditUserIds(s.allowedUserIds.join(", "));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();
  }, [token]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    setError("");
    try {
      const updates: { botToken?: string; allowedUserIds?: string[] } = {};

      if (editToken.trim()) {
        updates.botToken = editToken.trim();
      }

      const ids = editUserIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length > 0) {
        updates.allowedUserIds = ids;
      }

      const result = await updateTelegramConfig(updates, token);
      if (result.restartRequired) {
        setSaveMsg("Config saved. Restart required to apply changes.");
      } else {
        setSaveMsg("Config saved.");
      }
      setEditToken("");
      setEditing(false);
      fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setSaveMsg("");
    try {
      await restartService(token);
      setSaveMsg(
        "Restart initiated. Page may disconnect briefly while the service restarts."
      );
    } catch {
      // Expected — the restart kills the server, so the fetch will fail
      setSaveMsg(
        "Restart initiated. Page may disconnect briefly while the service restarts."
      );
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <div className="flex items-center justify-between mb-4 border-b-3 border-brutal-black pb-2">
        <h2 className="text-lg font-bold uppercase">Telegram Bot</h2>
        {status && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="bg-brutal-blue text-brutal-white font-bold uppercase py-1 px-3 brutal-border text-xs hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none brutal-shadow transition-all"
          >
            Edit
          </button>
        )}
      </div>

      {loading && <p className="font-mono text-sm">Checking status...</p>}
      {error && (
        <p className="font-mono text-sm text-brutal-red mb-2">{error}</p>
      )}
      {saveMsg && (
        <p className="font-mono text-sm text-brutal-green font-bold mb-2">
          {saveMsg}
        </p>
      )}

      {status && !editing && (
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
          {status.botToken && (
            <div className="flex justify-between">
              <span className="uppercase font-bold">Bot Token</span>
              <span className="text-brutal-black/60">{status.botToken}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="uppercase font-bold">Allowed Users</span>
            <span className="font-bold">{status.allowedUserCount}</span>
          </div>
          {status.allowedUserIds.length > 0 && (
            <div>
              <span className="uppercase font-bold block mb-1">User IDs</span>
              <div className="flex flex-wrap gap-1">
                {status.allowedUserIds.map((id) => (
                  <span
                    key={id}
                    className="bg-brutal-bg px-2 py-0.5 brutal-border text-xs"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleRestart}
            disabled={restarting}
            className="w-full mt-2 bg-brutal-orange text-brutal-black font-bold uppercase py-2 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50 text-sm"
          >
            {restarting ? "Restarting..." : "Restart Bot Service"}
          </button>
        </div>
      )}

      {editing && (
        <div className="space-y-4">
          <div>
            <label className="block font-mono text-xs uppercase font-bold mb-1">
              Bot Token
            </label>
            <input
              type="text"
              value={editToken}
              onChange={(e) => setEditToken(e.target.value)}
              placeholder={
                status?.botToken
                  ? `Current: ${status.botToken} (leave blank to keep)`
                  : "Enter Telegram bot token"
              }
              className="w-full brutal-border p-2 font-mono text-sm bg-brutal-bg"
            />
            <p className="font-mono text-xs text-brutal-black/40 mt-1">
              Get from @BotFather on Telegram. Leave blank to keep current.
            </p>
          </div>

          <div>
            <label className="block font-mono text-xs uppercase font-bold mb-1">
              Allowed User IDs
            </label>
            <input
              type="text"
              value={editUserIds}
              onChange={(e) => setEditUserIds(e.target.value)}
              placeholder="Comma-separated user IDs"
              className="w-full brutal-border p-2 font-mono text-sm bg-brutal-bg"
            />
            <p className="font-mono text-xs text-brutal-black/40 mt-1">
              Telegram user IDs, comma-separated. Use @userinfobot to find
              yours.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-brutal-green text-brutal-black font-bold uppercase py-2 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50 text-sm"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setEditToken("");
                setError("");
              }}
              className="flex-1 bg-brutal-white text-brutal-black font-bold uppercase py-2 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
