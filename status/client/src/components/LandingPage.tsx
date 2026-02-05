import { useBotName } from "../context/BotConfigContext";

export function LandingPage() {
  const { botName } = useBotName();

  const marqueeText = `// ONLINE // READY // BRUTAL // ${botName} // SYSTEMS GO // NO MERCY // ${botName} // `;

  return (
    <>
      <style>{`
        @keyframes glitch {
          0%, 100% {
            transform: translate(0);
            text-shadow: -2px 0 #ff6b6b, 2px 0 #339af0;
          }
          10% {
            transform: translate(-2px, -1px);
            text-shadow: 3px 0 #ff6b6b, -3px 0 #339af0;
          }
          20% {
            transform: translate(2px, 1px);
            text-shadow: -3px 0 #ff6b6b, 3px 0 #339af0;
          }
          30% {
            transform: translate(0);
            text-shadow: -2px 0 #ff6b6b, 2px 0 #339af0;
          }
          40% {
            transform: translate(-1px, -2px);
            text-shadow: 4px 0 #ff6b6b, -4px 0 #339af0;
          }
          50% {
            transform: translate(1px, 2px) skewX(-1deg);
            text-shadow: -2px 0 #ff6b6b, 2px 0 #339af0;
          }
          55% {
            transform: translate(0) skewX(0deg);
            text-shadow: -2px 0 #ff6b6b, 2px 0 #339af0;
          }
        }

        @keyframes glitch-clip-1 {
          0%, 100% { clip-path: inset(0 0 100% 0); }
          10% { clip-path: inset(20% 0 60% 0); }
          15% { clip-path: inset(50% 0 10% 0); }
          20% { clip-path: inset(0 0 100% 0); }
          40% { clip-path: inset(40% 0 20% 0); }
          45% { clip-path: inset(0 0 100% 0); }
        }

        @keyframes glitch-clip-2 {
          0%, 100% { clip-path: inset(100% 0 0 0); }
          12% { clip-path: inset(10% 0 70% 0); }
          18% { clip-path: inset(60% 0 5% 0); }
          22% { clip-path: inset(100% 0 0 0); }
          42% { clip-path: inset(30% 0 40% 0); }
          48% { clip-path: inset(100% 0 0 0); }
        }

        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes pulse-border {
          0%, 100% { border-color: #1a1a1a; }
          50% { border-color: #ff6b6b; }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(45deg); }
          50% { transform: translateY(-20px) rotate(45deg); }
        }

        @keyframes flicker {
          0%, 100% { opacity: 1; }
          92% { opacity: 1; }
          93% { opacity: 0.3; }
          94% { opacity: 1; }
          96% { opacity: 0.7; }
          97% { opacity: 1; }
        }

        .glitch-text {
          animation: glitch 3s infinite;
        }

        .glitch-text::before,
        .glitch-text::after {
          content: attr(data-text);
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }

        .glitch-text::before {
          color: #ff6b6b;
          animation: glitch-clip-1 3s infinite linear;
          transform: translate(-2px, -1px);
        }

        .glitch-text::after {
          color: #339af0;
          animation: glitch-clip-2 3s infinite linear;
          transform: translate(2px, 1px);
        }

        .marquee-track {
          animation: marquee 12s linear infinite;
        }

        .spin-slow {
          animation: spin-slow 20s linear infinite;
        }

        .float-shape {
          animation: float 6s ease-in-out infinite;
        }

        .flicker {
          animation: flicker 4s infinite;
        }

      `}</style>

      <div className="min-h-screen bg-brutal-bg overflow-hidden relative">
        {/* === BACKGROUND GRID LINES === */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {/* Vertical lines */}
          {[...Array(12)].map((_, i) => (
            <div
              key={`v-${i}`}
              className="absolute top-0 bottom-0 opacity-[0.06]"
              style={{
                left: `${(i + 1) * 8}%`,
                width: '1px',
                backgroundColor: '#1a1a1a',
              }}
            />
          ))}
          {/* Horizontal lines */}
          {[...Array(8)].map((_, i) => (
            <div
              key={`h-${i}`}
              className="absolute left-0 right-0 opacity-[0.06]"
              style={{
                top: `${(i + 1) * 11}%`,
                height: '1px',
                backgroundColor: '#1a1a1a',
              }}
            />
          ))}
        </div>

        {/* === DECORATIVE GEOMETRIC SHAPES === */}
        {/* Big yellow rotated square - top right */}
        <div
          className="absolute bg-brutal-yellow border-[3px] border-brutal-black hidden md:block"
          style={{
            width: '180px',
            height: '180px',
            top: '8%',
            right: '8%',
            transform: 'rotate(12deg)',
          }}
          aria-hidden="true"
        />
        {/* Shadow for yellow square */}
        <div
          className="absolute bg-brutal-black hidden md:block"
          style={{
            width: '180px',
            height: '180px',
            top: 'calc(8% + 8px)',
            right: 'calc(8% - 8px)',
            transform: 'rotate(12deg)',
            zIndex: 0,
          }}
          aria-hidden="true"
        />

        {/* Red block - left side */}
        <div
          className="absolute bg-brutal-red border-[3px] border-brutal-black float-shape hidden md:block"
          style={{
            width: '90px',
            height: '90px',
            top: '20%',
            left: '5%',
            transform: 'rotate(45deg)',
          }}
          aria-hidden="true"
        />

        {/* Blue spinning circle - bottom left */}
        <div
          className="absolute border-[4px] border-brutal-black spin-slow hidden md:block"
          style={{
            width: '120px',
            height: '120px',
            bottom: '15%',
            left: '10%',
            borderRadius: '0',
            borderRight: '4px dashed #339af0',
            borderBottom: '4px dashed #339af0',
          }}
          aria-hidden="true"
        />

        {/* Orange bar - right side */}
        <div
          className="absolute bg-brutal-orange border-[3px] border-brutal-black hidden lg:block"
          style={{
            width: '200px',
            height: '30px',
            bottom: '30%',
            right: '5%',
            transform: 'rotate(-6deg)',
          }}
          aria-hidden="true"
        />

        {/* Small purple square - bottom right */}
        <div
          className="absolute bg-brutal-purple border-[3px] border-brutal-black hidden md:block"
          style={{
            width: '60px',
            height: '60px',
            bottom: '25%',
            right: '18%',
            transform: 'rotate(20deg)',
          }}
          aria-hidden="true"
        />

        {/* Thick diagonal line */}
        <div
          className="absolute bg-brutal-black hidden lg:block"
          style={{
            width: '300px',
            height: '4px',
            top: '70%',
            left: '60%',
            transform: 'rotate(-35deg)',
          }}
          aria-hidden="true"
        />

        {/* Small green dot cluster */}
        <div className="absolute hidden md:flex gap-3" style={{ top: '55%', left: '3%' }} aria-hidden="true">
          <div className="w-4 h-4 bg-brutal-green border-2 border-brutal-black" />
          <div className="w-4 h-4 bg-brutal-green border-2 border-brutal-black" />
          <div className="w-4 h-4 bg-brutal-green border-2 border-brutal-black" />
        </div>

        {/* === MAIN CONTENT === */}
        <div className="relative z-10 min-h-screen flex flex-col">

          {/* TOP BAR */}
          <div className="w-full border-b-[3px] border-brutal-black bg-brutal-white px-4 py-2 flex justify-between items-center font-mono">
            <span className="text-xs md:text-sm font-bold tracking-widest uppercase opacity-60">
              SYS::STATUS
            </span>
            <span className="text-xs md:text-sm font-bold tracking-widest uppercase opacity-60 flicker">
              ● OPERATIONAL
            </span>
          </div>

          {/* HERO AREA */}
          <div className="flex-1 flex flex-col items-start justify-center px-6 md:px-16 lg:px-24 py-12">

            {/* Subtitle above */}
            <div className="mb-4 md:mb-6">
              <span className="font-mono text-xs md:text-sm font-bold tracking-[0.3em] uppercase bg-brutal-black text-brutal-white px-3 py-1 inline-block">
                DISCORD BOT // STATUS SYSTEM
              </span>
            </div>

            {/* Main hero name with offset shadow */}
            <div className="relative mb-6 md:mb-10 max-w-full">
              {/* Shadow block behind */}
              <div
                className="absolute bg-brutal-yellow border-[4px] border-brutal-black hidden sm:block"
                style={{
                  top: '8px',
                  left: '8px',
                  right: '-8px',
                  bottom: '-8px',
                  zIndex: 0,
                }}
              />
              {/* Main text container */}
              <div className="relative z-10 bg-brutal-white border-[4px] border-brutal-black px-4 sm:px-8 md:px-14 py-4 md:py-8">
                <h1
                  className="glitch-text relative font-mono font-black uppercase tracking-tighter leading-none select-none text-brutal-black"
                  data-text={botName}
                  style={{
                    fontSize: 'clamp(3.5rem, 12vw, 10rem)',
                  }}
                >
                  {botName}
                </h1>
              </div>
            </div>

            {/* Tagline / version line */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 items-start sm:items-center mb-8 md:mb-12">
              <div className="brutal-border bg-brutal-red px-4 py-2 brutal-shadow">
                <span className="font-mono text-sm md:text-base font-bold text-brutal-white tracking-wider uppercase">
                  V2.0 ACTIVE
                </span>
              </div>
              <div className="font-mono text-sm md:text-base font-bold tracking-wider opacity-50 uppercase">
                BUILT DIFFERENT // NO COMPROMISES
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 w-full max-w-3xl">
              {[
                { label: 'UPTIME', value: '99.9%', color: 'bg-brutal-green' },
                { label: 'LATENCY', value: '<50MS', color: 'bg-brutal-blue' },
                { label: 'COMMANDS', value: 'READY', color: 'bg-brutal-yellow' },
                { label: 'STATUS', value: 'LIVE', color: 'bg-brutal-orange' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className={`${stat.color} border-[3px] border-brutal-black p-3 md:p-4 brutal-shadow`}
                >
                  <div className="font-mono text-[10px] md:text-xs font-bold opacity-60 mb-1">{stat.label}</div>
                  <div className="font-mono text-lg md:text-2xl font-black">{stat.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* MARQUEE STRIP */}
          <div className="w-full border-t-[3px] border-b-[3px] border-brutal-black bg-brutal-black py-2 overflow-hidden">
            <div className="marquee-track whitespace-nowrap">
              <span className="font-mono text-sm md:text-base font-bold text-brutal-yellow tracking-widest">
                {marqueeText.repeat(8)}
              </span>
            </div>
          </div>

          {/* BOTTOM BAR */}
          <div className="w-full bg-brutal-white border-t-0 px-4 md:px-8 py-4 flex justify-between items-center">
            <div className="font-mono text-[10px] md:text-xs font-bold tracking-wider opacity-40 uppercase">
              &copy; {new Date().getFullYear()} {botName} // ALL SYSTEMS NOMINAL
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
