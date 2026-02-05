import { useState, useEffect } from "react";
import { getSSLStatus, renewSSL, generateSSLCert } from "../lib/adminApi";

interface Props {
  token: string;
}

export function AdminSSLPanel({ token }: Props) {
  const [status, setStatus] = useState<{
    hasCert: boolean;
    domain: string | null;
    expiry: string | null;
    certPath: string | null;
    autoRenew: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [renewing, setRenewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [renewOutput, setRenewOutput] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [showGenerator, setShowGenerator] = useState(false);

  useEffect(() => {
    setLoading(true);
    getSSLStatus(token)
      .then(setStatus)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleRenew = async () => {
    setRenewing(true);
    setRenewOutput("");
    try {
      const result = await renewSSL(token);
      setRenewOutput(result.output);
      const updated = await getSSLStatus(token);
      setStatus(updated);
    } catch (e) {
      setRenewOutput(e instanceof Error ? e.message : "Renewal failed");
    } finally {
      setRenewing(false);
    }
  };

  const handleGenerate = async () => {
    if (!newDomain.trim()) {
      setRenewOutput("Domain is required");
      return;
    }
    setGenerating(true);
    setRenewOutput("");
    try {
      const result = await generateSSLCert(newDomain, token);
      setRenewOutput(result.output);
      setNewDomain("");
      setShowGenerator(false);
      const updated = await getSSLStatus(token);
      setStatus(updated);
    } catch (e) {
      setRenewOutput(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <h2 className="text-lg font-bold uppercase mb-4 border-b-3 border-brutal-black pb-2">
        SSL / TLS
      </h2>

      {loading && <p className="font-mono text-sm">Checking status...</p>}
      {error && <p className="font-mono text-sm text-brutal-red">{error}</p>}

      {status && (
        <div className="space-y-3 font-mono text-sm">
          <div className="flex justify-between">
            <span className="uppercase font-bold">Certificate</span>
            <span
              className={`px-2 py-0.5 font-bold ${
                status.hasCert
                  ? "bg-brutal-green text-brutal-black"
                  : "bg-brutal-red text-brutal-white"
              }`}
            >
              {status.hasCert ? "ACTIVE" : "NONE"}
            </span>
          </div>
          {status.domain && (
            <div className="flex justify-between">
              <span className="uppercase font-bold">Domain</span>
              <span>{status.domain}</span>
            </div>
          )}
          {status.expiry && (
            <div className="flex justify-between">
              <span className="uppercase font-bold">Expires</span>
              <span>{status.expiry}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="uppercase font-bold">Auto-Renew</span>
            <span
              className={`px-2 py-0.5 font-bold ${
                status.autoRenew
                  ? "bg-brutal-green text-brutal-black"
                  : "bg-brutal-orange text-brutal-black"
              }`}
            >
              {status.autoRenew ? "ON" : "OFF"}
            </span>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleRenew}
              disabled={renewing}
              className="flex-1 bg-brutal-blue text-brutal-white font-bold uppercase py-2 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50 text-xs"
            >
              {renewing ? "Renewing..." : "Renew Now"}
            </button>
            <button
              onClick={() => setShowGenerator(!showGenerator)}
              className="flex-1 bg-brutal-black text-brutal-white font-bold uppercase py-2 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all text-xs"
            >
              {showGenerator ? "Cancel" : "New Domain"}
            </button>
          </div>

          {showGenerator && (
            <div className="mt-3 border-t-2 border-brutal-black pt-3 space-y-2">
              <label className="block text-xs uppercase font-bold">Domain</label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="example.com"
                className="w-full p-2 brutal-border font-mono text-sm bg-brutal-bg"
              />
              <button
                onClick={handleGenerate}
                disabled={generating || !newDomain.trim()}
                className="w-full bg-brutal-green text-brutal-black font-bold uppercase py-2 brutal-border hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none brutal-shadow transition-all disabled:opacity-50 text-xs"
              >
                {generating ? "Generating..." : "Generate Cert"}
              </button>
            </div>
          )}
        </div>
      )}

      {renewOutput && (
        <pre className="mt-4 bg-brutal-black text-brutal-green p-3 text-xs overflow-x-auto brutal-border max-h-48 overflow-y-auto">
          {renewOutput}
        </pre>
      )}
    </div>
  );
}
