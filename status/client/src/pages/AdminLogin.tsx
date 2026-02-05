import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAdminAuth } from "../hooks/useAdminAuth";
import { useBotName } from "../context/BotConfigContext";

export function AdminLogin() {
  const navigate = useNavigate();
  const { isAuthenticated, loading, loginAdmin, verifyMfaCode } =
    useAdminAuth();
  const { botName } = useBotName();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [partialToken, setPartialToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/admin/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await loginAdmin(username, password);
      if (result.requireMfa && result.partialToken) {
        setPartialToken(result.partialToken);
      }
      // If no MFA, the auth context will update and redirect happens via useEffect
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partialToken) return;
    setError("");
    setSubmitting(true);
    try {
      await verifyMfaCode(mfaCode, partialToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "MFA verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brutal-bg flex items-center justify-center">
        <div className="bg-brutal-yellow brutal-border brutal-shadow p-6">
          <span className="font-bold uppercase font-mono">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brutal-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight uppercase">
            {botName}
          </h1>
          <p className="text-sm mt-1 text-brutal-black/60 uppercase tracking-wide">
            Admin Login
          </p>
        </div>

        {/* Card */}
        <div className="bg-brutal-white brutal-border brutal-shadow-lg p-8">
          {error && (
            <div className="bg-brutal-red text-brutal-white brutal-border p-3 mb-4 font-mono text-sm font-bold">
              {error}
            </div>
          )}

          {/* MFA Step */}
          {partialToken ? (
            <form onSubmit={handleMfa}>
              <h2 className="text-lg font-bold uppercase mb-4">
                Enter MFA Code
              </h2>
              <p className="font-mono text-xs text-brutal-black/60 mb-4">
                Open your authenticator app and enter the 6-digit code.
              </p>
              <input
                type="text"
                value={mfaCode}
                onChange={(e) =>
                  setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                autoFocus
                className="w-full brutal-border p-3 font-mono text-2xl text-center tracking-[0.5em] bg-brutal-bg mb-4"
              />
              <button
                type="submit"
                disabled={submitting || mfaCode.length !== 6}
                className="w-full bg-brutal-yellow text-brutal-black font-bold uppercase py-3 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50"
              >
                {submitting ? "Verifying..." : "Verify"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPartialToken(null);
                  setMfaCode("");
                }}
                className="w-full mt-2 text-sm font-mono uppercase text-brutal-black/60 hover:text-brutal-black"
              >
                Back to login
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin}>
              <h2 className="text-lg font-bold uppercase mb-4">Sign In</h2>
              <div className="space-y-4">
                <div>
                  <label className="block font-mono text-xs uppercase font-bold mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoFocus
                    className="w-full brutal-border p-3 font-mono bg-brutal-bg"
                  />
                </div>
                <div>
                  <label className="block font-mono text-xs uppercase font-bold mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full brutal-border p-3 font-mono bg-brutal-bg"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-brutal-yellow text-brutal-black font-bold uppercase py-3 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50"
                >
                  {submitting ? "Signing in..." : "Sign In"}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Back to dashboard link */}
        <div className="mt-4 text-center">
          <Link
            to="/"
            className="font-mono text-xs uppercase text-brutal-black/60 hover:text-brutal-black"
          >
            &larr; Back to Status Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
