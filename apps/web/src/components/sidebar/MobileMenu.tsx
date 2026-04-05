"use client";

import { User } from "@solar-icons/react";
import { ChevronRight, X } from "lucide-react";
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

  // Match the browser chrome color to the menu background while open, so the
  // mobile status bar and URL bar blend into the menu instead of showing the
  // page theme color. Restores the previous value on close.
  useEffect(() => {
    if (!isMobileOpen) return;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!meta) return;
    const previous = meta.getAttribute("content");
    meta.setAttribute("content", "#0b0f1a");
    return () => {
      if (previous !== null) {
        meta.setAttribute("content", previous);
      }
    };
  }, [isMobileOpen]);

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

  // The outermost container handles tap-to-close so clicks on the blank
  // flex-spacer region (and any non-interactive area) dismiss the menu.
  // Link/button clicks still work because: (a) their own handlers run first,
  // (b) Next navigation → route change → SidebarProvider auto-closes,
  // (c) the bubbled close() call is idempotent.
  return (
    <div
      id="mobile-menu"
      ref={menuRef}
      role="dialog"
      aria-modal="true"
      aria-label="Main menu"
      className="fixed inset-0 z-[60] md:hidden"
      onClick={close}
    >
      {/* Backdrop — visual only, no pointer handling (the outer div owns clicks). */}
      <div
        className="animate-in fade-in absolute inset-0 bg-[#0b0f1a]/95 backdrop-blur-sm duration-150"
        aria-hidden="true"
      />

      {/* Menu surface */}
      <div
        className="animate-in slide-in-from-top-2 fade-in relative flex h-full flex-col duration-200"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 56px)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
          paddingLeft: "calc(env(safe-area-inset-left) + 24px)",
          paddingRight: "calc(env(safe-area-inset-right) + 24px)",
        }}
      >
        {/* Close button — subtle, muted color, no pill background.
            Positioned via inline style so safe-area insets apply correctly;
            Tailwind absolute positioning classes are intentionally omitted. */}
        <button
          type="button"
          onClick={close}
          aria-label="Close menu"
          className="text-muted-foreground hover:text-foreground absolute flex h-8 w-8 items-center justify-center transition-colors"
          style={{
            top: "calc(env(safe-area-inset-top) + 16px)",
            right: "calc(env(safe-area-inset-right) + 16px)",
          }}
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>

        {/* Nav section */}
        <nav aria-label="Primary">
          <p className="text-muted-foreground mb-3 text-[10px] font-semibold uppercase tracking-widest">
            Navigate
          </p>
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
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] transition-colors"
              >
                {link.svg}
              </a>
            ))}
          </div>

          <Link
            href="/account"
            className="hover:bg-white/[0.06] flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3.5 transition-colors"
          >
            <span className="bg-sidebar-accent text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-transparent">
              <User className="h-5 w-5" weight="Linear" />
            </span>
            <span className="text-foreground flex-1 text-sm font-semibold">Sign in</span>
            <ChevronRight className="text-muted-foreground h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
