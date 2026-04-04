"use client";

import { ChevronLeft, ChevronRight, Moon, Sun, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";

import { Button } from "@brawltome/ui";

import { useSidebar } from "./SidebarProvider";
import { useSidebarSections } from "./SidebarSectionsProvider";
import { navItems } from "./nav-items";
import { useScrollspy } from "./useScrollspy";

function SocialLinks({ collapsed }: { collapsed: boolean }) {
  const links = [
    {
      href: "https://discord.gg/ZEN8xQbNaE",
      label: "Discord",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
        </svg>
      ),
    },
    {
      href: "https://x.com/brawltome",
      label: "X",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
    },
    {
      href: "https://github.com/nicktacke/brawltome",
      label: "GitHub",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
      ),
    },
  ];

  return (
    <div
      className={`flex items-center gap-1 ${collapsed ? "flex-col" : "flex-row justify-center"}`}
    >
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={link.label}
          className="text-muted-foreground hover:text-foreground rounded-md p-2 transition-colors"
        >
          {link.icon}
        </a>
      ))}
    </div>
  );
}

function ContextualSections({ collapsed }: { collapsed: boolean }) {
  const sections = useSidebarSections();
  const activeId = useScrollspy(sections.map((s) => s.id));

  if (sections.length === 0) return null;

  if (collapsed) {
    return (
      <div className="border-border mt-2 flex flex-col items-center gap-1.5 border-t pt-3">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-label={section.label}
            className="block rounded-full transition-colors"
          >
            <div
              className={`rounded-full ${
                activeId === section.id
                  ? "bg-primary h-2 w-2"
                  : "bg-muted-foreground/30 h-1.5 w-1.5"
              }`}
            />
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className="border-border mt-2 border-t pt-3">
      <p className="text-muted-foreground px-4 pb-2 text-[10px] font-medium uppercase tracking-wider">
        On this page
      </p>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={`block py-1.5 pl-7 pr-4 text-xs transition-colors ${
            activeId === section.id
              ? "text-primary border-primary bg-primary/5 border-l-2"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {section.label}
        </a>
      ))}
    </div>
  );
}

export function AppSidebar() {
  const { isCollapsed, toggle } = useSidebar();
  const pathname = usePathname();
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <aside
      className={`bg-card border-border flex h-screen flex-col border-r transition-all duration-200 ${
        isCollapsed ? "w-[60px]" : "w-[220px]"
      }`}
    >
      {/* Header */}
      <div className="border-border flex items-center border-b p-3">
        {!isCollapsed && (
          <Link
            href="/"
            className="text-foreground text-sm font-bold tracking-tight"
          >
            BrawlTome
          </Link>
        )}
        {isCollapsed && (
          <Link
            href="/"
            className="text-foreground mx-auto text-base font-bold"
          >
            B
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className={`text-muted-foreground h-7 w-7 ${isCollapsed ? "mx-auto mt-1" : "ml-auto"}`}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {navItems.map((item) => {
          const isActive = item.href === pathname;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "text-primary border-primary bg-primary/10 border-l-2"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              } ${isCollapsed ? "justify-center px-0" : ""}`}
              title={isCollapsed ? item.label : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}

        <ContextualSections collapsed={isCollapsed} />
      </nav>

      {/* Bottom section */}
      <div className="border-border space-y-1 border-t px-2 py-2">
        <Button
          variant="ghost"
          onClick={() =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          }
          className={`text-muted-foreground hover:text-foreground w-full justify-start gap-3 ${isCollapsed ? "justify-center px-0" : ""}`}
          title={isCollapsed ? "Toggle theme" : undefined}
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-4 w-4 shrink-0" />
          ) : (
            <Moon className="h-4 w-4 shrink-0" />
          )}
          {!isCollapsed && <span className="text-sm">Theme</span>}
        </Button>

        <Link
          href="/account"
          className={`text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isCollapsed ? "justify-center px-0" : ""}`}
          title={isCollapsed ? "Account" : undefined}
        >
          <User className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span>Account</span>}
        </Link>

        <SocialLinks collapsed={isCollapsed} />
      </div>
    </aside>
  );
}
