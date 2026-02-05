import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminAuth } from "../hooks/useAdminAuth";
import { useStatus } from "../hooks/useStatus";
import { useBotName } from "../context/BotConfigContext";
import { AdminClaudePanel } from "../components/AdminClaudePanel";
import { AdminTelegramPanel } from "../components/AdminTelegramPanel";
import { AdminSSLPanel } from "../components/AdminSSLPanel";
import { AdminSecurityPanel } from "../components/AdminSecurityPanel";
import { AdminAgentPanel } from "../components/AdminAgentPanel";
import { ChatPanel } from "../components/ChatPanel";
import { AgentsPanel } from "../components/AgentsPanel";
import { ServiceCard } from "../components/ServiceCard";
import { SystemCard } from "../components/SystemCard";
import { CostCard } from "../components/CostCard";
import { resetChatSession, updateBotConfig } from "../lib/adminApi";

type Tab = "admin" | "chat" | "agents" | "dashboard";

function BotSettingsPanel({ token }: { token: string }) {
  const { botName, refetch } = useBotName();
  const [nameInput, setNameInput] = useState(botName);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSave = async () => {
    if (!nameInput.trim()) return;
    setSaving(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      await updateBotConfig({ botName: nameInput.trim() }, token);
      setStatusMsg("Bot name updated successfully.");
      refetch();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to update bot name");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <h2 className="text-xl font-bold uppercase mb-4 font-mono">Bot Settings</h2>

      {errorMsg && (
        <p className="font-mono text-sm text-brutal-red mb-2">{errorMsg}</p>
      )}
      {statusMsg && (
        <p className="font-mono text-sm text-brutal-green font-bold mb-2">
          {statusMsg}
        </p>
      )}

      <div>
        <label className="block text-xs uppercase font-bold font-mono mb-1">
          Bot Name
        </label>
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          className="w-full p-2 brutal-border font-mono text-sm bg-brutal-bg"
        />
      </div>

      <div className="mt-4">
        <button
          onClick={handleSave}
          disabled={saving || !nameInput.trim()}
          className="bg-brutal-black text-brutal-white font-bold uppercase py-2 px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-sm font-mono disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const { token, logout } = useAdminAuth();
  const { botName } = useBotName();
  const [activeTab, setActiveTab] = useState<Tab>("admin");
  const [chatSessionKey, setChatSessionKey] = useState(0);
  const { status, invocations, loading, error, connected } = useStatus();

  const handleReset = async () => {
    if (!token) return;
    try {
      await resetChatSession(token);
      setChatSessionKey((k) => k + 1);
    } catch {
      // Silently fail
    }
  };

  if (!token) return null;

  return (
    <div className="min-h-screen bg-brutal-bg p-4 md:p-10 w-full overflow-x-hidden box-border">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight uppercase">
              {botName}
            </h1>
            <p className="text-sm mt-1 text-brutal-black/60 uppercase tracking-wide">
              Admin Panel
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="bg-brutal-white text-brutal-black font-bold uppercase py-2 px-3 md:px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-xs md:text-sm font-mono"
            >
              Home
            </Link>
            <button
              onClick={logout}
              className="bg-brutal-red text-brutal-white font-bold uppercase py-2 px-3 md:px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-xs md:text-sm font-mono"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="flex gap-0 mb-6 w-full max-w-full items-center">
        <button
          onClick={() => setActiveTab("admin")}
          className={`font-bold uppercase py-2 md:py-3 px-4 md:px-6 brutal-border text-xs md:text-sm font-mono transition-all ${
            activeTab === "admin"
              ? "bg-brutal-black text-brutal-white brutal-shadow translate-x-0 translate-y-0"
              : "bg-brutal-white text-brutal-black hover:bg-brutal-bg"
          }`}
          style={{ borderRight: activeTab === "admin" ? undefined : "none" }}
        >
          Admin
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`font-bold uppercase py-2 md:py-3 px-4 md:px-6 brutal-border text-xs md:text-sm font-mono transition-all ${
            activeTab === "chat"
              ? "bg-brutal-black text-brutal-white brutal-shadow translate-x-0 translate-y-0"
              : "bg-brutal-white text-brutal-black hover:bg-brutal-bg"
          }`}
          style={{ borderRight: activeTab === "chat" ? undefined : "none" }}
        >
          Chat
        </button>
        <button
          onClick={() => setActiveTab("agents")}
          className={`font-bold uppercase py-2 md:py-3 px-4 md:px-6 brutal-border text-xs md:text-sm font-mono transition-all ${
            activeTab === "agents"
              ? "bg-brutal-black text-brutal-white brutal-shadow translate-x-0 translate-y-0"
              : "bg-brutal-white text-brutal-black hover:bg-brutal-bg"
          }`}
          style={{ borderRight: activeTab === "agents" ? undefined : "none" }}
        >
          Agents
        </button>
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`font-bold uppercase py-2 md:py-3 px-4 md:px-6 brutal-border text-xs md:text-sm font-mono transition-all ${
            activeTab === "dashboard"
              ? "bg-brutal-black text-brutal-white brutal-shadow translate-x-0 translate-y-0"
              : "bg-brutal-white text-brutal-black hover:bg-brutal-bg"
          }`}
        >
          Dashboard
        </button>
        {activeTab === "chat" && (
          <button
            onClick={handleReset}
            className="ml-auto bg-brutal-orange text-brutal-white font-bold uppercase py-2 md:py-3 px-4 md:px-6 brutal-border text-xs md:text-sm font-mono brutal-shadow hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-none transition-all"
          >
            New Session
          </button>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === "admin" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <AdminAgentPanel token={token} />
          <AdminClaudePanel token={token} />
          <AdminTelegramPanel token={token} />
          <AdminSSLPanel token={token} />
          <AdminSecurityPanel token={token} />
          <BotSettingsPanel token={token} />
        </div>
      )}

      {activeTab === "chat" && (
        <div className="w-full max-w-full overflow-hidden">
          <ChatPanel key={chatSessionKey} token={token} />
        </div>
      )}

      {activeTab === "agents" && (
        <AgentsPanel token={token} />
      )}

      {activeTab === "dashboard" && (
        <div>
          {/* Connection status */}
          <div className="flex items-center gap-2 mb-6">
            <div
              className={`w-3 h-3 rounded-full ${
                connected ? "bg-brutal-green animate-pulse" : "bg-brutal-red"
              }`}
            />
            <span className="text-xs uppercase font-bold">
              {connected ? "Live" : "Disconnected"}
            </span>
          </div>

          {/* Loading / Error states */}
          {loading && (
            <div className="bg-brutal-yellow brutal-border brutal-shadow p-6 mb-6">
              <span className="font-bold uppercase">Loading...</span>
            </div>
          )}

          {error && !status && (
            <div className="bg-brutal-red brutal-border brutal-shadow p-6 mb-6 text-brutal-white">
              <span className="font-bold uppercase">Connection Error: </span>
              <span>{error}</span>
            </div>
          )}

          {/* Dashboard Grid */}
          {status && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <ServiceCard
                status={status.service.status}
                uptime={status.service.uptime}
                pid={status.service.pid}
                memory={status.service.memory}
              />
              <SystemCard
                serverUptime={status.system.serverUptime}
                loadAvg={status.system.loadAvg}
                totalMemMB={status.system.totalMemMB}
                freeMemMB={status.system.freeMemMB}
                diskUsed={status.system.diskUsed}
                diskTotal={status.system.diskTotal}
                diskPercent={status.system.diskPercent}
              />
              <CostCard invocations={invocations} />
            </div>
          )}

          <div className="mt-6 text-center text-xs text-brutal-black/40 uppercase">
            Updated every 3s
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-10 text-center text-xs text-brutal-black/40 uppercase font-mono">
        {botName} Admin
      </footer>
    </div>
  );
}
