"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { CommandPalette } from "@/components/CommandPalette";
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
    // z-[60] keeps the overlay above page content that uses z-50
    // (e.g. the home page hero wrapper in app/page.tsx).
    <div className="fixed inset-0 z-[60] md:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={close}
        onKeyDown={(e) => e.key === "Escape" && close()}
        role="button"
        tabIndex={0}
        aria-label="Close menu"
      />
      {/* Slide-in sidebar - mobile shows labels, not tooltips.
          absolute inset-y-0 anchors the panel to the full height of the
          fixed inset-0 parent, which tracks the visual viewport on
          mobile browsers. This is more robust than h-dvh here. */}
      <div className="animate-in slide-in-from-left absolute inset-y-0 left-0 z-[61] w-[220px] duration-200">
        <AppSidebar />
      </div>
    </div>
  );
}

export function SidebarLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <>
      <CommandPalette />
      <MobileTopBar />
      <MobileOverlay />
      {/* Fixed desktop sidebar - does not affect content flow. h-dvh
          gives the AppSidebar (which uses h-full) a proper container
          height on both desktop and mobile browsers. */}
      <div className="hidden md:block fixed left-0 top-0 z-30 h-dvh">
        <AppSidebar />
      </div>

      {/* Reserve the sidebar width at md+ so content never sits underneath the
          fixed sidebar. Below md the sidebar is hidden (mobile overlay only),
          so no offset is needed. Home renders its own full-width layout
          (search + leaderboard centered within the remaining area); all other
          pages use the shared max-w-6xl content wrapper. */}
      <div className="md:pl-[57px]">
        {isHome ? (
          children
        ) : (
          <main className="min-h-screen">
            <div className="mx-auto max-w-6xl px-6 pt-10 pb-6 sm:pt-12">
              {children}
            </div>
          </main>
        )}
      </div>
    </>
  );
}
