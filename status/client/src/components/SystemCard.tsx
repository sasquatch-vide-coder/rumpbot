interface Props {
  serverUptime: string;
  loadAvg: number[];
  totalMemMB: number;
  freeMemMB: number;
  diskUsed: string;
  diskTotal: string;
  diskPercent: string;
}

function ProgressBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-bold uppercase">{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="w-full h-5 bg-brutal-bg brutal-border">
        <div
          className={`h-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SystemCard({ serverUptime, loadAvg, totalMemMB, freeMemMB, diskUsed, diskTotal, diskPercent }: Props) {
  const usedMemMB = totalMemMB - freeMemMB;
  const diskPct = parseInt(diskPercent, 10) || 0;

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <h2 className="text-sm uppercase tracking-widest mb-4 font-bold">
        System
      </h2>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="font-bold uppercase">Server Uptime</span>
          <span>{serverUptime}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold uppercase">Load Avg</span>
          <span>{loadAvg.map((l) => l.toFixed(2)).join(" / ")}</span>
        </div>
        <ProgressBar
          label={`Memory (${usedMemMB}/${totalMemMB} MB)`}
          value={usedMemMB}
          max={totalMemMB}
          color="bg-brutal-blue"
        />
        <ProgressBar
          label={`Disk (${diskUsed}/${diskTotal})`}
          value={diskPct}
          max={100}
          color="bg-brutal-orange"
        />
      </div>
    </div>
  );
}
