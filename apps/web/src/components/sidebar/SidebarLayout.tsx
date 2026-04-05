"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { CommandPalette } from "@/components/CommandPalette";
import { AppSidebar } from "./AppSidebar";
import { MobileFloatingMenuButton } from "./MobileFloatingMenuButton";
import { MobileMenu } from "./MobileMenu";

export function SidebarLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <>
      <CommandPalette />

      {/* Mobile chrome: menu self-gates on isMobileOpen. The home-page
          hamburger is rendered inline below, inside the home content branch,
          so it scrolls with page content instead of floating. */}
      <MobileMenu />

      {/* Fixed desktop sidebar - does not affect content flow. h-dvh gives the
          AppSidebar (which uses h-full) a proper container height. */}
      <div className="hidden md:block fixed left-0 top-0 z-30 h-dvh">
        <AppSidebar />
      </div>

      {/* Reserve the sidebar width at md+ so content never sits underneath the
          fixed sidebar. Below md the sidebar is hidden (mobile menu only),
          so no offset is needed. Home renders its own full-width layout
          (search + leaderboard centered within the remaining area); all other
          pages use the shared max-w-6xl content wrapper. */}
      <div className="md:pl-[57px]">
        {isHome ? (
          <>
            <div className="flex pl-5 pt-5 md:hidden">
              <MobileFloatingMenuButton />
            </div>
            {children}
          </>
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
