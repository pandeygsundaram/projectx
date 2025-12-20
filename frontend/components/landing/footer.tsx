import { Gamepad2, Github, Twitter, Disc } from "lucide-react";
import Link from "next/link";

export const Footer = () => {
  return (
    <footer className="border-t border-white/10 bg-background pt-20 pb-10">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-16">
          {/* Brand Column */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-6">
              <div className="bg-primary/20 p-1.5 rounded-lg">
                <Gamepad2 className="h-5 w-5 text-primary" />
              </div>
              <span className="text-xl font-bold">HitBox</span>
            </Link>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs">
              The AI-native game engine for the web. Build, ship, and monetize
              3D experiences without leaving your browser.
            </p>
            <div className="flex gap-4">
              <a
                href="#"
                className="text-muted-foreground hover:text-white transition-colors"
              >
                <Twitter className="w-5 h-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-white transition-colors"
              >
                <Github className="w-5 h-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-white transition-colors"
              >
                <Disc className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Product</h4>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Engine
            </a>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Assets
            </a>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Hosting
            </a>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Pricing
            </a>
          </div>

          {/* Company */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Company</h4>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              About
            </a>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Blog
            </a>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Careers
            </a>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Contact
            </a>
          </div>

          {/* Legal */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Legal</h4>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Privacy
            </a>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Terms
            </a>
            <a
              href="#"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Cookie Policy
            </a>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © 2024 HitBox Inc. All rights reserved.
          </p>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/50 border border-white/5">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-xs font-mono text-muted-foreground">
              All Systems Operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
