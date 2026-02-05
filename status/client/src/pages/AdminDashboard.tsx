import { Link } from "react-router-dom";
import { useAdminAuth } from "../hooks/useAdminAuth";
import { AdminClaudePanel } from "../components/AdminClaudePanel";
import { AdminTelegramPanel } from "../components/AdminTelegramPanel";
import { AdminSSLPanel } from "../components/AdminSSLPanel";
import { AdminSecurityPanel } from "../components/AdminSecurityPanel";

export function AdminDashboard() {
  const { token, logout } = useAdminAuth();

  if (!token) return null;

  return (
    <div className="min-h-screen bg-brutal-bg p-6 md:p-10">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight uppercase">
              Rumpbot
            </h1>
            <p className="text-sm mt-1 text-brutal-black/60 uppercase tracking-wide">
              Admin Panel
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="bg-brutal-white text-brutal-black font-bold uppercase py-2 px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-sm font-mono"
            >
              Dashboard
            </Link>
            <button
              onClick={logout}
              className="bg-brutal-red text-brutal-white font-bold uppercase py-2 px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-sm font-mono"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Admin Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <AdminClaudePanel token={token} />
        <AdminTelegramPanel token={token} />
        <AdminSSLPanel token={token} />
        <AdminSecurityPanel token={token} />
      </div>

      {/* Footer */}
      <footer className="mt-10 text-center text-xs text-brutal-black/40 uppercase font-mono">
        Rumpbot Admin
      </footer>
    </div>
  );
}
