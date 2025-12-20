const LOGOS = [
  "Vercel",
  "OpenAI",
  "React",
  "ThreeJS",
  "Unity",
  "Unreal",
  "Godot",
  "NVIDIA",
];

export const CompanyMarquee = () => {
  return (
    <section className="py-12 border-y border-white/5 bg-black/20 backdrop-blur-sm">
      <div className="container mx-auto px-6 mb-8 text-center">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
          Powering next-gen experiences built with
        </p>
      </div>

      <div className="relative flex overflow-hidden group">
        <div className="flex animate-marquee whitespace-nowrap">
          {/* Double the list for seamless loop */}
          {[...LOGOS, ...LOGOS, ...LOGOS].map((logo, i) => (
            <div
              key={i}
              className="mx-8 md:mx-16 flex items-center justify-center"
            >
              <span className="text-xl md:text-2xl font-bold text-muted-foreground/40 hover:text-primary transition-colors cursor-default select-none">
                {logo}
              </span>
            </div>
          ))}
        </div>

        {/* Fade Edges */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-background to-transparent"></div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-background to-transparent"></div>
      </div>

      <style>{`
        .animate-marquee {
          animation: marquee 40s linear infinite;
        }
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </section>
  );
};
