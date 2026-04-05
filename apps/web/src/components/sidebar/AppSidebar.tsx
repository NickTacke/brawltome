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

import { useSidebarSections } from "./SidebarSectionsProvider";
import { navItems } from "./nav-items";
import { useScrollspy } from "./useScrollspy";

// Fixed sidebar width. The bar is never collapsible or extendable - labels
// appear as tooltips on hover instead. Mobile renders an overlay with labels.
// 57 = 1px border-r + 8px nav padding + 40px icon tile + 8px nav padding.
// The extra pixel compensates for the 1px right border (box-sizing: border-box
// eats it from the content area) so icons sit exactly centered in the visible
// sidebar area.
export const SIDEBAR_WIDTH = 57;

// Discord / X / GitHub brand icons (inline SVGs)
const socialLinks = [
  {
    href: "https://discord.gg/ZEN8xQbNaE",
    label: "Discord",
    svg: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5 fill-current"
        fillRule="evenodd"
      >
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0187 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
      </svg>
    ),
  },
  {
    href: "https://x.com/brawltome",
    label: "X",
    svg: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    href: "https://github.com/NickTacke/brawltome",
    label: "GitHub",
    svg: (
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    ),
  },
];

/**
 * Wraps a trigger in a tooltip that only renders on the right side.
 * When the sidebar is expanded (mobile overlay), no tooltip is shown.
 */
function MaybeTooltip({
  label,
  expanded,
  children,
}: {
  label: string;
  expanded: boolean;
  children: ReactNode;
}) {
  if (expanded) return <>{children}</>;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ContextualSections({ expanded }: { expanded: boolean }) {
  const sections = useSidebarSections();
  const activeId = useScrollspy(sections.map((s) => s.id));

  if (sections.length === 0) return null;

  return (
    <div className="border-sidebar-border mt-4 border-t px-2 pt-3">
      {expanded && (
        <p className="text-muted-foreground mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider">
          On this page
        </p>
      )}
      {sections.map((section) => {
        const isActive = activeId === section.id;
        const dot = (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-label={section.label}
            className={`group my-1 flex items-center rounded-lg transition-colors ${
              expanded ? "w-full" : "w-10"
            } ${
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
            {expanded && (
              <span className="whitespace-nowrap text-xs font-medium">
                {section.label}
              </span>
            )}
          </a>
        );

        return (
          <MaybeTooltip key={section.id} label={section.label} expanded={expanded}>
            {dot}
          </MaybeTooltip>
        );
      })}
    </div>
  );
}

/**
 * Icon-only sidebar with tooltips on hover. The `expanded` prop is only used
 * by the mobile slide-over overlay, which renders the same sidebar with
 * labels instead of tooltips.
 */
export function AppSidebar({ expanded = false }: { expanded?: boolean }) {
  const pathname = usePathname();
  const width = expanded ? 220 : SIDEBAR_WIDTH;

  return (
    <TooltipProvider>
      <aside
        className="bg-sidebar border-sidebar-border text-sidebar-foreground flex h-screen flex-col overflow-hidden border-r"
        style={{ width }}
      >
        {/* Main nav. Scrollbar is hidden visually (functionality preserved) so
            it doesn't eat space from the right side, which would make icons
            appear shifted left when scrollspy sections overflow the viewport. */}
        <nav className="flex-1 overflow-y-auto px-2 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => {
            const isActive = item.href === pathname;
            const Icon = item.icon;
            const link = (
              <Link
                href={item.href}
                className={`my-2 flex items-center rounded-lg transition-colors ${
                  expanded ? "w-full" : "w-10"
                } ${
                  isActive
                    ? "text-foreground bg-white/[0.08]"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                }`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                  <Icon className="h-6 w-6" weight={item.iconWeight ?? "Linear"} />
                </div>
                {expanded && (
                  <span className="whitespace-nowrap text-sm font-semibold">
                    {item.label}
                  </span>
                )}
              </Link>
            );
            return (
              <MaybeTooltip key={item.href} label={item.label} expanded={expanded}>
                {link}
              </MaybeTooltip>
            );
          })}

          <ContextualSections expanded={expanded} />
        </nav>

        {/* Bottom section - socials + account */}
        <div className="border-sidebar-border shrink-0 border-t px-2 py-2">
          {/* Socials as rounded icon buttons, matching nav items */}
          <div className="mb-1">
            {socialLinks.map((link) => {
              const button = (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  className={`text-muted-foreground hover:bg-white/[0.04] hover:text-foreground my-1 flex items-center rounded-lg transition-colors ${
                    expanded ? "w-full" : "w-10"
                  }`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                    {link.svg}
                  </div>
                  {expanded && (
                    <span className="whitespace-nowrap text-sm font-medium">
                      {link.label}
                    </span>
                  )}
                </a>
              );
              return (
                <MaybeTooltip key={link.label} label={link.label} expanded={expanded}>
                  {button}
                </MaybeTooltip>
              );
            })}
          </div>

          {/* Account with avatar - rounded button matching nav items.
              Avatar is 40x40 with rounded-lg (8px) for a 20% ratio, matching
              the legend avatars on PlayerProfile (80px rounded-2xl). */}
          <div className="border-sidebar-border border-t pt-2">
            <MaybeTooltip label="Sign in" expanded={expanded}>
              <Link
                href="/account"
                className={`text-muted-foreground hover:bg-white/[0.04] hover:text-foreground flex items-center rounded-lg transition-colors ${
                  expanded ? "w-full" : "w-10"
                }`}
              >
                <div className="bg-sidebar-accent text-muted-foreground border-sidebar flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2">
                  <User className="h-6 w-6" weight="Linear" />
                </div>
                {expanded && (
                  <span className="ml-0 whitespace-nowrap text-sm font-medium">
                    Sign in
                  </span>
                )}
              </Link>
            </MaybeTooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
