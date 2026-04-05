"use client";

import { Menu } from "lucide-react";

import { useSidebar } from "./SidebarProvider";

/**
 * Floating hamburger button for the home page. Fixed position, top-left,
 * always visible on mobile. Hidden on desktop since the icon rail handles
 * navigation there.
 */
export function MobileFloatingMenuButton() {
  const { open, isMobileOpen } = useSidebar();

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open menu"
      aria-expanded={isMobileOpen}
      aria-controls="mobile-menu"
      className="bg-background/60 text-foreground hover:bg-background/80 fixed z-40 flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] backdrop-blur-md transition-colors md:hidden"
      style={{
        top: "calc(env(safe-area-inset-top) + 12px)",
        left: "calc(env(safe-area-inset-left) + 12px)",
      }}
    >
      <Menu className="h-5 w-5" strokeWidth={2} />
    </button>
  );
}
