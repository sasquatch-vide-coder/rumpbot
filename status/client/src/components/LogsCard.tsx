import { useEffect, useRef } from "react";

interface Props {
  logs: string[];
}

export function LogsCard({ logs }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-brutal-white brutal-border brutal-shadow p-6 col-span-full">
      <h2 className="text-sm uppercase tracking-widest mb-4 font-bold">
        Recent Logs
      </h2>
      <div
        ref={scrollRef}
        className="bg-brutal-black text-brutal-green p-4 brutal-border h-64 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="text-brutal-green/50">No logs available</div>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all hover:bg-brutal-green/10">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
