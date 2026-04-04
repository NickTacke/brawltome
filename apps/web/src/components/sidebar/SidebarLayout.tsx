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
      {/* Slide-in sidebar */}
      <div className="animate-in slide-in-from-left relative z-50 h-full w-[260px] duration-200">
        <AppSidebar />
      </div>
    </div>
  );
}

export function SidebarLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  if (isHome) {
    return <>{children}</>;
  }

  return (
    <>
      <MobileTopBar />
      <MobileOverlay />
      <div className="flex h-screen">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <AppSidebar />
        </div>

        {/* Content area */}
        <main className="min-h-screen flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-6 pt-3 sm:pt-6">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
