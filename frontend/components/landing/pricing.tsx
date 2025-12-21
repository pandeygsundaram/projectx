"use client";

import React, { useState } from "react";
import { Check, Zap, HelpCircle } from "lucide-react";
import { Button } from "../ui/button";

const tiers = [
  {
    name: "Hobby",
    price: { monthly: 0, annual: 0 },
    description: "For experimentation and learning.",
    features: [
      "Unlimited public projects",
      "50 AI asset generations / mo",
      "Community support",
      "Standard hosting (US-East)",
      "1GB Storage",
    ],
    cta: "Start for Free",
    variant: "outline",
  },
  {
    name: "Indie",
    price: { monthly: 29, annual: 24 },
    description: "For solo developers shipping games.",
    popular: true, // Highlights this card
    features: [
      "Unlimited private projects",
      "1,000 AI asset generations / mo",
      "Priority build queue",
      "Global Edge Hosting (Multi-region)",
      'Remove "Built with Dotpad" badge',
      "Smart NPC Brains (GPT-4o)",
    ],
    cta: "Go Pro",
    variant: "default",
  },
  {
    name: "Studio",
    price: { monthly: 99, annual: 79 },
    description: "For teams building next-gen experiences.",
    features: [
      "Unlimited asset generations",
      "Dedicated instance & SLA",
      "Team collaboration & Roles",
      "Custom LLM fine-tuning",
      "SSO & Audit Logs",
      "24/7 Dedicated Support",
    ],
    cta: "Contact Sales",
    variant: "outline",
  },
];

export const Pricing = () => {
  const [annual, setAnnual] = useState(true);

  return (
    <section
      id="pricing"
      className="py-24 relative overflow-hidden bg-background"
    >
      {/* Background Decor */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="container mx-auto px-6 relative z-10">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-4xl font-bold mb-4 tracking-tight">
            Simple, transparent pricing
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Start for free, upgrade when you ship.
          </p>

          {/* Toggle Switch */}
          <div className="flex items-center justify-center gap-4">
            <span
              className={`text-sm font-medium transition-colors ${
                !annual ? "text-white" : "text-muted-foreground"
              }`}
            >
              Monthly
            </span>
            <button
              onClick={() => setAnnual(!annual)}
              className="relative w-12 h-6 rounded-full bg-white/10 border border-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <div
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-primary shadow-sm transition-transform duration-200 ${
                  annual ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
            <span
              className={`text-sm font-medium transition-colors ${
                annual ? "text-white" : "text-muted-foreground"
              }`}
            >
              Yearly{" "}
              <span className="text-xs text-green-400 font-mono ml-1">
                (-20%)
              </span>
            </span>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto items-start">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl p-8 border transition-all duration-300 ${
                tier.popular
                  ? "bg-zinc-900/80 border-primary/50 shadow-[0_0_40px_rgba(139,92,246,0.15)] scale-105 z-10"
                  : "bg-zinc-900/40 border-white/10 hover:border-white/20"
              }`}
            >
              {/* Popular Badge */}
              {tier.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-purple-400 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-lg">
                  Most Popular
                </div>
              )}

              {/* Title & Price */}
              <div className="mb-8">
                <h3 className="text-lg font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  {tier.name}
                  {tier.popular && (
                    <Zap className="w-4 h-4 text-primary fill-primary" />
                  )}
                </h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">
                    ${annual ? tier.price.annual : tier.price.monthly}
                  </span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                </div>
                <p className="text-sm text-muted-foreground mt-4 leading-relaxed h-10">
                  {tier.description}
                </p>
              </div>

              {/* CTA Button */}
              <Button
                variant={tier.popular ? "default" : "outline"}
                className={`w-full mb-8 ${
                  tier.popular
                    ? "shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                    : "border-white/10 hover:bg-white/5"
                }`}
              >
                {tier.cta}
              </Button>

              {/* Feature List */}
              <ul className="space-y-4">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 text-sm text-zinc-300"
                  >
                    <Check
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        tier.popular ? "text-primary" : "text-zinc-500"
                      }`}
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* FAQ / Trust Footer */}
        <div className="mt-20 text-center border-t border-white/5 pt-12">
          <p className="text-muted-foreground text-sm flex items-center justify-center gap-2">
            <HelpCircle className="w-4 h-4" />
            Need help choosing?{" "}
            <a href="#" className="text-primary hover:underline">
              Chat with us
            </a>
          </p>
        </div>
      </div>
    </section>
  );
};
