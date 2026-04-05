"use client";

import { User } from "@solar-icons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@brawltome/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { socialLinks } from "./social-links";
import { useSidebarSections } from "./SidebarSectionsProvider";
import { navItems } from "./nav-items";
import { useScrollspy } from "./useScrollspy";

// Fixed sidebar width. The bar is never collapsible or extendable — labels
// appear as tooltips on hover instead.
// 57 = 1px border-r + 8px nav padding + 40px icon tile + 8px nav padding.
// The extra pixel compensates for the 1px right border (box-sizing: border-box
// eats it from the content area) so icons sit exactly centered in the visible
// sidebar area.
export const SIDEBAR_WIDTH = 57;

function WithTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ContextualSections() {
  const sections = useSidebarSections();
  const activeId = useScrollspy(sections.map((s) => s.id));

  if (sections.length === 0) return null;

  return (
    <div className="border-sidebar-border mt-4 border-t px-2 pt-3">
      {sections.map((section) => {
        const isActive = activeId === section.id;
        return (
          <WithTooltip key={section.id} label={section.label}>
            <a
              href={`#${section.id}`}
              aria-label={section.label}
              className={`group my-1 flex w-10 items-center rounded-lg transition-colors ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                <div
                  className={`rounded-full transition-all ${
                    isActive
                      ? "bg-foreground h-2 w-2"
                      : "bg-muted-foreground/40 group-hover:bg-muted-foreground h-1.5 w-1.5"
                  }`}
                />
              </div>
            </a>
          </WithTooltip>
        );
      })}
    </div>
  );
}

/**
 * Desktop-only icon-rail sidebar. Hidden on mobile via its container in
 * SidebarLayout. Mobile uses the separate MobileMenu component.
 */
export function AppSidebar() {
  const pathname = usePathname();

  return (
    <TooltipProvider>
      <aside
        className="bg-sidebar border-sidebar-border text-sidebar-foreground flex h-full flex-col overflow-hidden border-r"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <nav className="flex-1 overflow-y-auto px-2 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => {
            const isActive = item.href === pathname;
            const Icon = item.icon;
            return (
              <WithTooltip key={item.href} label={item.label}>
                <Link
                  href={item.href}
                  className={`my-2 flex w-10 items-center rounded-lg transition-colors ${
                    isActive
                      ? "text-foreground bg-white/[0.08]"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  }`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                    <Icon className="h-6 w-6" weight={item.iconWeight ?? "Linear"} />
                  </div>
                </Link>
              </WithTooltip>
            );
          })}

          <ContextualSections />
        </nav>

        <div className="border-sidebar-border shrink-0 border-t px-2 py-2">
          <div className="mb-2">
            {socialLinks.map((link) => (
              <WithTooltip key={link.label} label={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground my-1 flex w-10 items-center rounded-lg transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                    {link.svg}
                  </div>
                </a>
              </WithTooltip>
            ))}
          </div>

          <div className="border-sidebar-border border-t pt-2">
            <WithTooltip label="Sign in">
              <Link
                href="/account"
                className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground flex w-10 items-center rounded-lg transition-colors"
              >
                <div className="bg-sidebar-accent text-muted-foreground border-sidebar flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2">
                  <User className="h-6 w-6" weight="Linear" />
                </div>
              </Link>
            </WithTooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
