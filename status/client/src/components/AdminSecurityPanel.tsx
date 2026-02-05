import { useState } from "react";
import {
  getMfaSetup,
  enableMfa,
  disableMfa,
  changePassword,
} from "../lib/adminApi";
import { useAdminAuth } from "../hooks/useAdminAuth";

interface Props {
  token: string;
}

export function AdminSecurityPanel({ token }: Props) {
  const { mfaEnabled, checkSetupStatus } = useAdminAuth();

  // MFA state
  const [mfaSetup, setMfaSetup] = useState<{
    secret: string;
    qrCode: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState("");
  const [mfaSuccess, setMfaSuccess] = useState("");

  // Password state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const handleStartMfaSetup = async () => {
    setMfaLoading(true);
    setMfaError("");
    try {
      const result = await getMfaSetup(token);
      setMfaSetup({ secret: result.secret, qrCode: result.qrCode });
    } catch (e) {
      setMfaError(e instanceof Error ? e.message : "Failed to setup MFA");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleEnableMfa = async () => {
    if (mfaCode.length !== 6) {
      setMfaError("Code must be 6 digits");
      return;
    }
    setMfaLoading(true);
    setMfaError("");
    try {
      await enableMfa(mfaCode, token);
      setMfaSuccess("MFA enabled successfully");
      setMfaSetup(null);
      setMfaCode("");
      await checkSetupStatus();
    } catch (e) {
      setMfaError(e instanceof Error ? e.message : "Failed to enable MFA");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleDisableMfa = async () => {
    setMfaLoading(true);
    setMfaError("");
    try {
      await disableMfa(token);
      setMfaSuccess("MFA disabled");
      await checkSetupStatus();
    } catch (e) {
      setMfaError(e instanceof Error ? e.message : "Failed to disable MFA");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 8) {
      setPwError("Password must be at least 8 characters");
      return;
    }
    setPwLoading(true);
    setPwError("");
    setPwSuccess("");
    try {
      await changePassword(currentPw, newPw, token);
      setPwSuccess("Password changed");
      setCurrentPw("");
      setNewPw("");
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <h2 className="text-lg font-bold uppercase mb-4 border-b-3 border-brutal-black pb-2">
        Security
      </h2>

      {/* MFA Section */}
      <div className="mb-6">
        <h3 className="font-bold uppercase text-sm mb-3">
          Two-Factor Authentication
        </h3>

        <div className="flex items-center gap-2 mb-3 font-mono text-sm">
          <span className="uppercase font-bold">Status:</span>
          <span
            className={`px-2 py-0.5 font-bold ${
              mfaEnabled
                ? "bg-brutal-green text-brutal-black"
                : "bg-brutal-orange text-brutal-black"
            }`}
          >
            {mfaEnabled ? "ENABLED" : "DISABLED"}
          </span>
        </div>

        {mfaError && (
          <p className="text-brutal-red font-mono text-xs mb-2">{mfaError}</p>
        )}
        {mfaSuccess && (
          <p className="text-brutal-green font-mono text-xs mb-2 font-bold">
            {mfaSuccess}
          </p>
        )}

        {!mfaEnabled && !mfaSetup && (
          <button
            onClick={handleStartMfaSetup}
            disabled={mfaLoading}
            className="bg-brutal-purple text-brutal-white font-bold uppercase py-2 px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50 text-sm"
          >
            {mfaLoading ? "Loading..." : "Enable MFA"}
          </button>
        )}

        {mfaSetup && (
          <div className="space-y-3">
            <p className="font-mono text-xs">
              Scan this QR code with your authenticator app:
            </p>
            <div className="flex justify-center">
              <img
                src={mfaSetup.qrCode}
                alt="MFA QR Code"
                className="brutal-border"
              />
            </div>
            <div className="font-mono text-xs">
              <span className="font-bold uppercase">Manual key: </span>
              <code className="bg-brutal-bg px-1 break-all">
                {mfaSetup.secret}
              </code>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={mfaCode}
                onChange={(e) =>
                  setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="6-digit code"
                className="flex-1 brutal-border p-2 font-mono text-sm bg-brutal-bg"
              />
              <button
                onClick={handleEnableMfa}
                disabled={mfaLoading || mfaCode.length !== 6}
                className="bg-brutal-green text-brutal-black font-bold uppercase py-2 px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50 text-sm"
              >
                Verify
              </button>
            </div>
          </div>
        )}

        {mfaEnabled && (
          <button
            onClick={handleDisableMfa}
            disabled={mfaLoading}
            className="bg-brutal-red text-brutal-white font-bold uppercase py-2 px-4 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50 text-sm"
          >
            {mfaLoading ? "..." : "Disable MFA"}
          </button>
        )}
      </div>

      {/* Change Password */}
      <div className="border-t-3 border-brutal-black pt-4">
        <h3 className="font-bold uppercase text-sm mb-3">Change Password</h3>

        {pwError && (
          <p className="text-brutal-red font-mono text-xs mb-2">{pwError}</p>
        )}
        {pwSuccess && (
          <p className="text-brutal-green font-mono text-xs mb-2 font-bold">
            {pwSuccess}
          </p>
        )}

        <form onSubmit={handleChangePassword} className="space-y-3">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password"
            className="w-full brutal-border p-2 font-mono text-sm bg-brutal-bg"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (min 8 chars)"
            className="w-full brutal-border p-2 font-mono text-sm bg-brutal-bg"
          />
          <button
            type="submit"
            disabled={pwLoading}
            className="w-full bg-brutal-yellow text-brutal-black font-bold uppercase py-2 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50 text-sm"
          >
            {pwLoading ? "Changing..." : "Change Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
