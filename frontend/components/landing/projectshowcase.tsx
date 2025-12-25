"use client";

import React, { useRef, useState } from "react";
import { Rocket, ExternalLink } from "lucide-react";

const showcaseProjects = [
  {
    title: "Project Alpha",
    description: "An innovative 3D experience built with our AI-native game engine",
    url: "https://pub-18b55177615f46d3a53f3d84747d7f02.r2.dev/deployments/f4d6f3ed-1b7f-47f5-ab45-0fc6b06c9217/dist/index.html",
    gradient: "from-purple-500/20 via-pink-500/20 to-red-500/20",
  },
  {
    title: "Project Beta",
    description: "A cutting-edge interactive game showcasing real-time AI mechanics",
    url: "https://pub-18b55177615f46d3a53f3d84747d7f02.r2.dev/deployments/2204f0b7-6d0f-4de0-950f-5cd8e531475a/dist/index.html",
    gradient: "from-blue-500/20 via-cyan-500/20 to-teal-500/20",
  },
];

const SpotlightCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
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
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition duration-300"
        style={{
          opacity,
          background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, rgba(139,92,246,0.1), transparent 40%)`,
        }}
      />
      <div className="relative h-full flex flex-col">{children}</div>
    </div>
  );
};

export const ProjectShowcase = () => {
  return (
    <section className="py-24 relative bg-background overflow-hidden">
      {/* Background Grids */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px]"></div>

      <div className="container mx-auto px-6 relative z-10">
        <div className="mb-16 max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-medium text-primary mb-6 uppercase tracking-wider">
            <Rocket className="w-3 h-3" />
            <span>Built With Hitbox</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight text-white">
            Projects in Action
          </h2>
          <p className="text-muted-foreground text-lg">
            Real games built by our community using the Hitbox engine.
          </p>
        </div>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {showcaseProjects.map((project, i) => (
            <SpotlightCard key={i} className="group cursor-pointer">
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-6 h-full flex flex-col"
              >
                {/* Project Visual Preview */}
                <div className={`relative w-full h-48 mb-6 rounded-lg overflow-hidden bg-gradient-to-br ${project.gradient} border border-white/10`}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-24 h-24 rounded-lg border border-primary/40 bg-primary/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <Rocket className="w-12 h-12 text-primary" />
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent opacity-60"></div>
                </div>

                {/* Project Info */}
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    {project.title}
                    <ExternalLink className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {project.description}
                  </p>
                </div>

                {/* View Project Link */}
                <div className="mt-6 pt-4 border-t border-white/5">
                  <span className="text-sm font-semibold text-primary group-hover:text-white transition-colors flex items-center gap-2">
                    View Live Demo
                    <span className="group-hover:translate-x-1 transition-transform inline-block">→</span>
                  </span>
                </div>
              </a>
            </SpotlightCard>
          ))}
        </div>
      </div>
    </section>
  );
};
