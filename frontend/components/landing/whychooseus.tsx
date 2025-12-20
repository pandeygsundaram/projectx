export const WhyChooseUs = () => {
  return (
    <section className="py-24 bg-black/20">
      <div className="container mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold mb-12 text-center">
          Why top developers choose Dotpad
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 md:grid-rows-2 gap-6 h-auto md:h-[600px]">
          {/* Card 1: Speed (Large Left) */}
          <div className="md:col-span-2 md:row-span-2 relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-gray-900 to-black p-8 flex flex-col justify-end group">
            <div className="absolute inset-0 bg-grid opacity-20 group-hover:opacity-30 transition-opacity"></div>
            <div className="relative z-10">
              <div className="text-6xl font-bold text-primary mb-4">10x</div>
              <h3 className="text-2xl font-bold mb-2">
                Faster Development Cycles
              </h3>
              <p className="text-muted-foreground">
                Skip the setup. Our AI scaffolding handles 90% of the repetitive
                Three.js setup code, letting you focus purely on unique
                mechanics.
              </p>
            </div>
            {/* Decoration */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-[100px] pointer-events-none"></div>
          </div>

          {/* Card 2: Quality (Top Right) */}
          <div className="rounded-3xl border border-white/10 bg-card p-8 flex flex-col justify-center hover:border-primary/50 transition-colors">
            <h3 className="text-xl font-bold mb-2 text-white">
              Production Ready
            </h3>
            <p className="text-sm text-muted-foreground">
              We export standard React code. No black boxes. You own the source
              code and can eject at any time.
            </p>
          </div>

          {/* Card 3: Community (Bottom Right) */}
          <div className="rounded-3xl border border-white/10 bg-card p-8 flex flex-col justify-center hover:border-primary/50 transition-colors">
            <h3 className="text-xl font-bold mb-2 text-white">
              Multiplayer Native
            </h3>
            <p className="text-sm text-muted-foreground">
              Every project comes with a WebSocket server pre-configured.
              Building .io games has never been easier.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
