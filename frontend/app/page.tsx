import { Features } from "@/components/home(401)/features";
import { Footer } from "@/components/home(401)/footer";
import { HeroSection } from "@/components/home(401)/hero";
import { Navbar } from "@/components/home(401)/navbar";
import { Pricing } from "@/components/home(401)/pricing";
import { WhyChooseUs } from "@/components/home(401)/whychooseus";
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
