"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { AppSidebar } from "./AppSidebar";
import { MobileTopBar } from "./MobileTopBar";
import { useSidebar } from "./SidebarProvider";

function MobileOverlay() {
  const { isMobileOpen, close } = useSidebar();

  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileOpen]);

  if (!isMobileOpen) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={close}
        onKeyDown={(e) => e.key === "Escape" && close()}
        role="button"
        tabIndex={0}
        aria-label="Close menu"
      />
      {/* Slide-in sidebar - mobile shows labels, not tooltips */}
      <div className="animate-in slide-in-from-left relative z-50 h-full w-[220px] duration-200">
        <AppSidebar expanded />
      </div>
    </div>
  );
}

export function SidebarLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <>
      <MobileTopBar />
      <MobileOverlay />
      {/* Fixed desktop sidebar - does not affect content flow */}
      <div className="hidden md:block fixed left-0 top-0 z-30">
        <AppSidebar />
      </div>

      {/* Home renders its own full-width layout (search + leaderboard centered
          to the viewport). All other pages use the shared max-w-6xl content
          wrapper. The sidebar is fixed-positioned so it overlays in both cases
          without affecting the content's horizontal centering. */}
      {isHome ? (
        children
      ) : (
        <main className="min-h-screen">
          <div className="mx-auto max-w-6xl px-6 pt-10 pb-6 sm:pt-12">
            {children}
          </div>
        </main>
      )}
    </>
  );
}
