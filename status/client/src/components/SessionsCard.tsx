interface Session {
  chatId: string;
  projectDir: string;
  lastUsedAt: number;
}

interface Props {
  sessionCount: number;
  lastActivity: number | null;
  sessions: Session[];
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

export function SessionsCard({ sessionCount, lastActivity, sessions }: Props) {
  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6">
      <h2 className="text-sm uppercase tracking-widest mb-4 font-bold">
        Sessions
      </h2>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-4xl font-bold">{sessionCount}</span>
        <span className="text-sm uppercase">active</span>
      </div>
      {lastActivity && (
        <div className="text-sm mb-4">
          <span className="font-bold uppercase">Last Activity: </span>
          <span>{timeAgo(lastActivity)}</span>
        </div>
      )}
      {sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.chatId}
              className="bg-brutal-bg brutal-border p-3 text-xs"
            >
              <div className="font-bold">Chat {s.chatId}</div>
              <div className="truncate text-brutal-black/60">
                {s.projectDir}
              </div>
              <div>{timeAgo(s.lastUsedAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
