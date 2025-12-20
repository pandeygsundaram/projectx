import { Link } from "react-router-dom";

import { Zap, Code2, Box, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export const HeroSection = () => {
  return (
    <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
      <div className="container mx-auto px-6 relative z-10 text-center">
        {/* Status Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/50 border border-white/10 text-xs font-mono text-primary mb-8 animate-fade-in-up hover:bg-secondary/70 transition-colors cursor-default">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          AI MODEL V1.0.4 ONLINE
        </div>

        {/* Main Headline */}
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight mb-8 leading-tight">
          <span className="bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/40">
            Generate Worlds.
          </span>
          <br />
          <span className="text-primary drop-shadow-[0_0_40px_rgba(139,92,246,0.2)]">
            Ship Games.
          </span>
        </h1>

        {/* Subheadline */}
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed">
          The first AI-native game engine. Describe your mechanics, models, and
          logic. We compile it to React Three Fiber and deploy it to the edge
          instantly.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
          <Link to="/signup" className="w-full sm:w-auto">
            <Button
              size="lg"
              className="h-14 px-8 text-lg w-full shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:shadow-[0_0_50px_rgba(139,92,246,0.5)] transition-all duration-300"
            >
              <Zap className="mr-2 h-5 w-5" /> Start Building
            </Button>
          </Link>
          <Button
            variant="outline"
            size="lg"
            className="h-14 px-8 text-lg w-full sm:w-auto border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/10"
          >
            Documentation <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        {/* Terminal/Preview Mockup */}
        <div className="mx-auto max-w-5xl rounded-xl border border-white/10 bg-black/50 backdrop-blur-2xl shadow-2xl overflow-hidden ring-1 ring-white/5">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
              <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              dotpad-engine — preview
            </div>
            <div className="w-16"></div>
          </div>
          <div className="grid md:grid-cols-2 h-[400px]">
            {/* Left: Chat */}
            <div className="p-6 border-r border-white/10 flex flex-col justify-between font-mono text-sm text-left bg-black/20">
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground uppercase tracking-widest">
                    Prompt
                  </div>
                  <div className="text-foreground">
                    "Create a low-poly racing game in a neon city. Add a drift
                    mechanic and a chase camera."
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground uppercase tracking-widest">
                    Agent Log
                  </div>
                  <div className="text-primary/80 space-y-1">
                    <div>➜ Generating assets: neon_car.gltf...</div>
                    <div>➜ Writing physics controller (Cannon.js)...</div>
                    <div>➜ Compiling React Fiber scene...</div>
                    <div className="text-green-400">
                      ✓ Build Complete (2.4s)
                    </div>
                  </div>
                </div>
              </div>
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-xl opacity-20"></div>
                <Input
                  placeholder="Refine physics..."
                  className="bg-black/50 border-white/10 font-mono relative z-10 focus:border-primary/50"
                />
              </div>
            </div>
            {/* Right: Visual */}
            <div className="relative bg-grid-pattern flex items-center justify-center overflow-hidden">
              {/* Just a visual abstraction of a 3D scene */}
              <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent"></div>
              <div className="relative z-10 w-32 h-32 border border-primary bg-primary/5 shadow-[0_0_100px_rgba(139,92,246,0.3)] animate-pulse rounded-lg flex items-center justify-center">
                <Box className="w-12 h-12 text-primary" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none -z-10"></div>
    </section>
  );
};
