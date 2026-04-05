"use client";

import { User } from "@solar-icons/react";
import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { navItems } from "./nav-items";
import { socialLinks } from "./social-links";
import { useSidebar } from "./SidebarProvider";

/**
 * Full-screen mobile navigation menu. Self-gates on isMobileOpen so it can be
 * mounted unconditionally by the layout. Desktop hides it entirely via md:hidden.
 *
 * Accessibility: rendered as role="dialog" aria-modal="true", closes on Escape,
 * traps Tab focus to the menu's interactive elements while open, and closes
 * automatically on route change via SidebarProvider's pathname effect.
 */
export function MobileMenu() {
  const { isMobileOpen, close } = useSidebar();
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);

  // Body scroll lock while open.
  // NOTE: When wiring this component into SidebarLayout, ensure the legacy
  // MobileOverlay is removed in the same change. Two components running
  // independent scroll-lock effects on the same body produce non-deterministic
  // restoration when the menu closes.
  useEffect(() => {
    if (!isMobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobileOpen]);

  // Theme-color sync now lives in SidebarProvider.open/close so the meta tag
  // updates synchronously with the click event, keeping the browser chrome in
  // lock-step with the menu's appearance.

  // Escape to close + Tab focus trap + initial focus.
  useEffect(() => {
    if (!isMobileOpen) return;
    const menu = menuRef.current;
    if (!menu) return;

    const getFocusables = () =>
      Array.from(
        menu.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    // Focus the first nav link on open so screen readers announce the menu
    // content, not the close button.
    const initial = getFocusables();
    initial[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = getFocusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!menu.contains(document.activeElement)) {
        // Focus escaped the dialog (e.g., browser chrome stole it). Recapture
        // to the first focusable so the trap stays honest.
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobileOpen, close]);

  if (!isMobileOpen) return null;

  // Closing the menu is deliberate: use the X button, press Escape, or tap a
  // nav link (which navigates and then SidebarProvider's pathname effect
  // auto-closes). Tapping empty space inside the menu does NOT close it.
  return (
    <div
      id="mobile-menu"
      ref={menuRef}
      role="dialog"
      aria-modal="true"
      aria-label="Main menu"
      className="fixed inset-0 z-[60] md:hidden"
    >
      {/* Backdrop — visual only, no pointer handling (the outer div owns clicks).
          Color matches layout.tsx's themeColor so the menu blends with the iOS
          browser chrome (status bar + URL bar) without any theme-color change.
          Background is applied via inline style to bypass Tailwind JIT quirks
          with arbitrary color values under Turbopack HMR. */}
      <div
        className="animate-in fade-in absolute inset-0 duration-150"
        style={{ backgroundColor: "#1e2530" }}
        aria-hidden="true"
      />

      {/* Menu surface */}
      <div
        className="animate-in slide-in-from-top-2 fade-in relative flex h-full flex-col duration-200"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 24px)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
          paddingLeft: "calc(env(safe-area-inset-left) + 24px)",
          paddingRight: "calc(env(safe-area-inset-right) + 24px)",
        }}
      >
        {/* Nav section */}
        <nav aria-label="Primary">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
              Navigate
            </p>
            <button
              type="button"
              onClick={close}
              aria-label="Close menu"
              className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
            >
              <X className="h-6 w-6" strokeWidth={2} />
            </button>
          </div>
          <ul className="flex flex-col">
            {navItems.map((item) => {
              const isActive = item.href === pathname;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-4 border-b border-white/[0.06] py-4 text-2xl font-bold tracking-tight transition-colors ${
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon
                      className={`h-6 w-6 ${isActive ? "opacity-100" : "opacity-60"}`}
                      weight={item.iconWeight ?? "Linear"}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Spacer — tapping here passes through to the backdrop click handler
            because this div has no pointer-capturing content. */}
        <div className="flex-1" />

        {/* Footer: socials + sign-in */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/account"
            className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground inline-flex items-center gap-2.5 rounded-xl px-1.5 py-2.5 text-base font-medium transition-colors"
          >
            <User className="h-5 w-5" weight="Linear" />
            Sign in
          </Link>

          <div className="flex items-center gap-1">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
              >
                {link.svg}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
