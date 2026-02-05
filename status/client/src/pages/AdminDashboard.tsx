import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminAuth } from "../hooks/useAdminAuth";
import { AdminClaudePanel } from "../components/AdminClaudePanel";
import { AdminTelegramPanel } from "../components/AdminTelegramPanel";
import { AdminSSLPanel } from "../components/AdminSSLPanel";
import { AdminSecurityPanel } from "../components/AdminSecurityPanel";
import { AdminAgentPanel } from "../components/AdminAgentPanel";
import { ChatPanel } from "../components/ChatPanel";

type Tab = "dashboard" | "chat";

export function AdminDashboard() {
  const { token, logout } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  if (!token) return null;

  return (
    <div className="min-h-screen bg-brutal-bg p-4 md:p-10 w-full overflow-x-hidden box-border">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight uppercase">
              TIFFBOT
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
              Dashboard
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
      <div className="flex gap-0 mb-6 w-full max-w-full">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`font-bold uppercase py-2 md:py-3 px-4 md:px-6 brutal-border text-xs md:text-sm font-mono transition-all ${
            activeTab === "dashboard"
              ? "bg-brutal-black text-brutal-white brutal-shadow translate-x-0 translate-y-0"
              : "bg-brutal-white text-brutal-black hover:bg-brutal-bg"
          }`}
          style={{ borderRight: activeTab === "dashboard" ? undefined : "none" }}
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
        >
          Chat
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "dashboard" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <AdminAgentPanel token={token} />
          <AdminClaudePanel token={token} />
          <AdminTelegramPanel token={token} />
          <AdminSSLPanel token={token} />
          <AdminSecurityPanel token={token} />
        </div>
      )}

      {activeTab === "chat" && (
        <div className="w-full max-w-full overflow-hidden">
          <ChatPanel token={token} />
        </div>
      )}

      {/* Footer */}
      <footer className="mt-10 text-center text-xs text-brutal-black/40 uppercase font-mono">
        TIFFBOT Admin
      </footer>
    </div>
  );
}
