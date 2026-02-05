import { useState, useEffect, useCallback } from "react";
import { useAdminAuth } from "../hooks/useAdminAuth";
import type { InvocationEntry } from "../hooks/useStatus";

interface LifetimeStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalInvocations: number;
  maxTurnsHits: number;
  firstRecordedAt: string;
  lastUpdatedAt: string;
}

interface Props {
  invocations: InvocationEntry[];
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function CostCard({ invocations }: Props) {
  const { token } = useAdminAuth();
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats | null>(null);

  const fetchLifetimeStats = useCallback(async () => {
    try {
      const headers: HeadersInit = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/lifetime-stats", { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.error) {
        setLifetimeStats(data);
      }
    } catch {
      // Non-critical
    }
  }, [token]);

  useEffect(() => {
    fetchLifetimeStats();
    const timer = setInterval(fetchLifetimeStats, 10000);
    return () => clearInterval(timer);
  }, [fetchLifetimeStats]);

  // Rolling window stats from recent invocations
  const recentCost = invocations.reduce((sum, i) => sum + (i.costUsd || 0), 0);
  const recentCount = invocations.length;
  const avgCost = recentCount > 0 ? recentCost / recentCount : 0;
  const avgDuration = recentCount > 0
    ? invocations.reduce((sum, i) => sum + (i.durationMs || 0), 0) / recentCount / 1000
    : 0;
  const totalTurns = invocations.reduce((sum, i) => sum + (i.numTurns || 0), 0);
  const errors = invocations.filter((i) => i.isError).length;
  const recentMaxTurnsHits = invocations.filter((i) => i.stopReason === "error_max_turns").length;

  // Use lifetime stats for "All Time" display, fall back to rolling window
  const allTimeCost = lifetimeStats?.totalCost ?? recentCost;
  const allTimeInvocations = lifetimeStats?.totalInvocations ?? recentCount;
  const allTimeMaxTurnsHits = lifetimeStats?.maxTurnsHits ?? recentMaxTurnsHits;
  const allTimeInput = lifetimeStats?.totalInputTokens ?? 0;
  const allTimeOutput = lifetimeStats?.totalOutputTokens ?? 0;
  const allTimeCacheRead = lifetimeStats?.totalCacheReadTokens ?? 0;
  const allTimeCacheCreation = lifetimeStats?.totalCacheCreationTokens ?? 0;

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6 col-span-full lg:col-span-2">
      <h2 className="text-sm uppercase tracking-widest mb-4 font-bold">
        Cost & Usage
      </h2>

      {/* All Time stats from lifetime persistence */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-brutal-yellow brutal-border p-3">
          <div className="text-xs uppercase font-bold">All Time Cost</div>
          <div className="text-2xl font-bold">${allTimeCost.toFixed(2)}</div>
        </div>
        <div className="bg-brutal-blue/20 brutal-border p-3">
          <div className="text-xs uppercase font-bold">All Time Invocations</div>
          <div className="text-2xl font-bold">{allTimeInvocations}</div>
        </div>
        <div className="bg-brutal-purple/20 brutal-border p-3">
          <div className="text-xs uppercase font-bold">Avg Cost</div>
          <div className="text-2xl font-bold">${avgCost.toFixed(2)}</div>
        </div>
        <div className="bg-brutal-orange/20 brutal-border p-3">
          <div className="text-xs uppercase font-bold">Max Turns Hits</div>
          <div className="text-2xl font-bold">{allTimeMaxTurnsHits}</div>
        </div>
      </div>

      {/* Recent Activity stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 text-sm">
        <div className="flex justify-between">
          <span className="font-bold uppercase">Recent Cost</span>
          <span>${recentCost.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold uppercase">Total Turns</span>
          <span>{totalTurns}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold uppercase">Errors</span>
          <span className={errors > 0 ? "text-brutal-red font-bold" : ""}>{errors}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold uppercase">Avg Duration</span>
          <span>{avgDuration.toFixed(1)}s</span>
        </div>
      </div>

      {/* Token usage - All Time from lifetime stats */}
      <div className="bg-brutal-bg brutal-border p-4 text-sm">
        <div className="font-bold uppercase text-xs tracking-widest mb-2">Token Usage (All Time)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs uppercase text-brutal-black/60">Input</div>
            <div className="font-bold">{formatTokens(allTimeInput)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-brutal-black/60">Output</div>
            <div className="font-bold">{formatTokens(allTimeOutput)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-brutal-black/60">Cache Read</div>
            <div className="font-bold">{formatTokens(allTimeCacheRead)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-brutal-black/60">Cache Write</div>
            <div className="font-bold">{formatTokens(allTimeCacheCreation)}</div>
          </div>
        </div>
      </div>

      {/* Tracking info */}
      {lifetimeStats && (
        <div className="mt-2 text-xs text-brutal-black/40 flex justify-between">
          <span>Tracking since {new Date(lifetimeStats.firstRecordedAt).toLocaleDateString()}</span>
          <span>Last used {timeAgo(new Date(lifetimeStats.lastUpdatedAt).getTime())}</span>
        </div>
      )}

      {/* Recent invocations */}
      {invocations.length > 0 && (
        <div className="mt-4">
          <div className="font-bold uppercase text-xs tracking-widest mb-2">Recent</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {invocations.slice(0, 10).map((inv, i) => (
              <div key={i} className="flex justify-between text-xs bg-brutal-bg brutal-border px-3 py-1">
                <span>{timeAgo(inv.timestamp)}</span>
                {inv.tier && (
                  <span className="text-brutal-black/50 uppercase">{inv.tier.slice(0, 4)}</span>
                )}
                <span>{inv.numTurns || 0} turns</span>
                <span>{((inv.durationMs || 0) / 1000).toFixed(1)}s</span>
                <span className="font-bold">${(inv.costUsd || 0).toFixed(2)}</span>
                <span className={
                  inv.isError ? "text-brutal-red" :
                  inv.stopReason === "error_max_turns" ? "text-brutal-orange" :
                  "text-brutal-green"
                }>
                  {inv.isError ? "ERR" : inv.stopReason === "error_max_turns" ? "MAX" : "OK"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
