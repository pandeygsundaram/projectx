import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { HeroSection } from "@/components/landing/hero";
import { Navbar } from "@/components/landing/navbar";
import { Pricing } from "@/components/landing/pricing";
import { WhyChooseUs } from "@/components/landing/whychooseus";
import React from "react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden text-foreground">
      {/* Background Decor */}
      <div className="fixed inset-0 bg-grid z-0 pointer-events-none opacity-[0.15]"></div>

      <Navbar />

      <main>
        <HeroSection />

        <Features />
        <WhyChooseUs />
        <Pricing />
      </main>
      <Footer />
    </div>
  );
}
