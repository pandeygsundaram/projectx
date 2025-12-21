"use client";

import React, { useRef, useState } from "react";
import {
  Terminal,
  Box,
  Zap,
  Globe,
  Cpu,
  Layers,
  MessageSquare,
  ArrowRight,
} from "lucide-react";

// --- Visual Mocks ---

const MockTerminal = () => (
  <div className="w-full h-full rounded-md border border-white/10 bg-black/50 p-3 font-mono text-[10px] text-muted-foreground leading-relaxed opacity-70 overflow-hidden">
    <div className="flex gap-1.5 mb-2">
      <div className="w-1.5 h-1.5 rounded-full bg-red-500/40" />
      <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/40" />
      <div className="w-1.5 h-1.5 rounded-full bg-green-500/40" />
    </div>
    <div className="space-y-1">
      <p>
        <span className="text-primary">const</span>{" "}
        <span className="text-blue-300">world</span> ={" "}
        <span className="text-yellow-300">useWorld</span>();
      </p>
      <p>
        <span className="text-primary">await</span> world.
        <span className="text-purple-300">generate</span>({`{`}
      </p>
      <p className="pl-2">
        biome: <span className="text-green-300">'cyberpunk_slums'</span>,
      </p>
      <p className="pl-2">
        physics: <span className="text-orange-300">true</span>
      </p>
      <p>{`}`});</p>
      <p className="animate-pulse text-primary mt-1">_</p>
    </div>
  </div>
);

const MockWireframe = () => (
  <div className="relative w-full h-24 flex items-center justify-center overflow-hidden">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/10 to-transparent" />
    <div className="w-16 h-16 border border-primary/40 rotate-45 animate-[spin_10s_linear_infinite] flex items-center justify-center">
      <div className="w-8 h-8 border border-white/20 rotate-45" />
    </div>
  </div>
);

const MockServer = () => (
  <div className="flex items-center gap-2 mt-auto pt-4">
    <div className="flex gap-0.5 items-end h-4">
      <div className="w-1 bg-green-500/50 h-2 animate-pulse" />
      <div className="w-1 bg-green-500/50 h-3 animate-pulse delay-75" />
      <div className="w-1 bg-green-500/50 h-1.5 animate-pulse delay-150" />
    </div>
    <div className="text-[10px] font-mono text-green-400 tracking-wider">
      MS: 12ms
    </div>
  </div>
);

const MockChat = () => (
  <div className="flex flex-col gap-2 mt-2">
    <div className="bg-white/5 border border-white/5 self-start rounded-lg rounded-tl-none px-2 py-1.5 text-[10px] text-muted-foreground max-w-[80%]">
      Patrol this area.
    </div>
    <div className="bg-primary/20 border border-primary/20 self-end rounded-lg rounded-tr-none px-2 py-1.5 text-[10px] text-primary-foreground max-w-[80%]">
      Affirmative. Moving to sector 7.
    </div>
  </div>
);

// --- Data (Reordered for perfect 3-column fit) ---
// Layout: [2][1] -> [2][1] -> [1][2]
const features = [
  {
    colSpan: "md:col-span-2",
    icon: <Terminal className="w-4 h-4" />,
    title: "Text-to-Game Engine",
    desc: "Natural language to React Three Fiber code. We handle the boilerplate.",
    visual: <MockTerminal />,
  },
  {
    colSpan: "md:col-span-1",
    icon: <Box className="w-4 h-4" />,
    title: "Asset Synthesis",
    desc: "Generative 3D GLTF models optimized for web.",
    visual: <MockWireframe />,
  },
  {
    colSpan: "md:col-span-2",
    icon: <Layers className="w-4 h-4" />,
    title: "Visual Scene Editor",
    desc: "Bi-directional editing. Move objects in the viewport, see code update instantly.",
    visual: (
      <div className="absolute right-0 bottom-0 w-1/2 h-full bg-gradient-to-l from-white/5 to-transparent skew-x-12 opacity-50 pointer-events-none" />
    ),
  },
  {
    colSpan: "md:col-span-1",
    icon: <Globe className="w-4 h-4" />,
    title: "Edge Hosting",
    desc: "Global low-latency deployment.",
    visual: <MockServer />,
  },
  {
    colSpan: "md:col-span-1",
    icon: <Cpu className="w-4 h-4" />,
    title: "AI NPC Brains",
    desc: "Inject LLM personalities into any character mesh.",
    visual: <MockChat />,
  },
  // The CTA Card is now part of the data flow to ensure it fits the grid
  {
    isCTA: true,
    colSpan: "md:col-span-2",
    title: "Ready to ship?",
    desc: "Start building your dream game engine today.",
  },
];

// --- Components ---

const SpotlightCard = ({ children, className = "", noSpotlight = false }: { children: React.ReactNode; className?: string; noSpotlight?: boolean }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current || noSpotlight) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={`relative overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60 transition-all hover:border-white/20 ${className}`}
    >
      {!noSpotlight && (
        <div
          className="pointer-events-none absolute -inset-px opacity-0 transition duration-300"
          style={{
            opacity,
            background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, rgba(139,92,246,0.1), transparent 40%)`,
          }}
        />
      )}
      <div className="relative h-full flex flex-col">{children}</div>
    </div>
  );
};

export const Features = () => {
  return (
    <section className="py-24 relative bg-background overflow-hidden">
      {/* Background Grids */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px]"></div>

      <div className="container mx-auto px-6 relative z-10">
        <div className="mb-16 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-medium text-primary mb-6 uppercase tracking-wider">
            <Zap className="w-3 h-3" />
            <span>Feature Set V1</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight text-white">
            Everything you need to ship.
          </h2>
          <p className="text-muted-foreground text-lg">
            A cohesive stack replacing 15+ fragmented tools.
          </p>
        </div>

        {/* Tighter Grid: gap-4 instead of gap-6 or 8 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-[minmax(180px,auto)]">
          {features.map((f, i) => {
            if (f.isCTA) {
              return (
                <SpotlightCard
                  key={i}
                  className={`${f.colSpan} bg-gradient-to-br from-primary/10 via-zinc-900/60 to-zinc-900/60 flex flex-col justify-center items-center text-center p-8 border-primary/20 group cursor-pointer`}
                >
                  <div className="mb-4 p-3 rounded-full bg-primary/20 text-primary group-hover:scale-110 transition-transform duration-300">
                    <Zap className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">
                    {f.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                    {f.desc}
                  </p>
                  <button className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-white transition-colors">
                    Launch Console <ArrowRight className="w-4 h-4" />
                  </button>
                </SpotlightCard>
              );
            }

            return (
              <SpotlightCard key={i} className={`${f.colSpan} p-6`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-white/5 rounded-md border border-white/5 text-primary">
                    {f.icon}
                  </div>
                </div>

                <div className="mb-4">
                  <h3 className="text-base font-bold text-white mb-1">
                    {f.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                </div>

                {/* Visual fills remaining space */}
                <div className="mt-auto pt-4 w-full">{f.visual}</div>
              </SpotlightCard>
            );
          })}
        </div>
      </div>
    </section>
  );
};
