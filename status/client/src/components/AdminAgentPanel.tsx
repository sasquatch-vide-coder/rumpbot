import { useState, useEffect } from "react";
import {
  getAgentConfig,
  updateAgentConfig,
} from "../lib/adminApi";
import type { AgentConfigData, AgentTierConfig } from "../lib/adminApi";

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
  { id: "claude-opus-4-5-20251101", label: "Opus 4.5" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
];

interface TierEditorProps {
  label: string;
  config: AgentTierConfig;
  onChange: (updated: AgentTierConfig) => void;
  showDivider?: boolean;
}

function TierEditor({ label, config, onChange, showDivider }: TierEditorProps) {
  return (
    <div className={showDivider ? "border-t-2 border-brutal-black/20 pt-4 mt-4" : ""}>
      <h3 className="font-bold uppercase font-mono text-sm mb-3">{label}</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-xs uppercase font-bold font-mono mb-1">
            Model
          </label>
          <select
            value={config.model}
            onChange={(e) => onChange({ ...config, model: e.target.value })}
            className="w-full p-2 brutal-border font-mono text-sm bg-brutal-bg"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase font-bold font-mono mb-1">
            Max Turns
          </label>
          <input
            type="number"
            min={1}
            value={config.maxTurns}
            onChange={(e) =>
              onChange({ ...config, maxTurns: Math.max(1, parseInt(e.target.value) || 1) })
            }
            className="w-full p-2 brutal-border font-mono text-sm bg-brutal-bg"
          />
        </div>
        <div>
          <label className="block text-xs uppercase font-bold font-mono mb-1">
            Timeout (seconds)
          </label>
          <input
            type="number"
            min={0}
            value={config.timeoutMs > 0 ? config.timeoutMs / 1000 : 0}
            onChange={(e) => {
              const secs = Math.max(0, parseInt(e.target.value) || 0);
              onChange({ ...config, timeoutMs: secs * 1000 });
            }}
            className="w-full p-2 brutal-border font-mono text-sm bg-brutal-bg"
          />
          <p className="font-mono text-xs text-brutal-black/40 mt-1">
            0 = no timeout
          </p>
        </div>
      </div>
    </div>
  );
}

export function AdminAgentPanel({ token }: { token: string }) {
  const [config, setConfig] = useState<AgentConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  const fetchConfig = () => {
    setLoading(true);
    setError("");
    getAgentConfig(token)
      .then(setConfig)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load config"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchConfig();
  }, [token]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setStatusMsg("");
    setError("");
    try {
      const result = await updateAgentConfig(config, token);
      setConfig(result.config);
      setStatusMsg("Configuration saved successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  const updateTier = (tier: keyof AgentConfigData) => (updated: AgentTierConfig) => {
    if (!config) return;
    setConfig({ ...config, [tier]: updated });
  };

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <h2 className="text-xl font-bold uppercase mb-4 font-mono">Agent Tiers</h2>

      {loading && <p className="font-mono text-sm">Loading agent config...</p>}
      {error && (
        <p className="font-mono text-sm text-brutal-red mb-2">{error}</p>
      )}
      {statusMsg && (
        <p className="font-mono text-sm text-brutal-green font-bold mb-2">
          {statusMsg}
        </p>
      )}

      {config && (
        <div>
          <TierEditor
            label="Chat Agent"
            config={config.chat}
            onChange={updateTier("chat")}
          />
          <TierEditor
            label="Executor"
            config={config.executor}
            onChange={updateTier("executor")}
            showDivider
          />

          <div className="mt-6">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-brutal-black text-brutal-white font-bold uppercase py-2 px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-sm font-mono disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save All"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
