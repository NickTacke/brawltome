"use client";

import { Menu, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";

import { Button } from "@brawltome/ui/button";

import { useSidebar } from "./SidebarProvider";

export function MobileTopBar() {
  const { open } = useSidebar();
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <div className="bg-card border-border flex items-center justify-between border-b px-3 py-2 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={open}
        aria-label="Open menu"
        className="h-8 w-8"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Link href="/" className="text-foreground text-sm font-bold">
        BrawlTome
      </Link>

      <Button
        variant="ghost"
        size="icon"
        onClick={() =>
          setTheme(resolvedTheme === "dark" ? "light" : "dark")
        }
        className="h-8 w-8"
        aria-label="Toggle theme"
      >
        {resolvedTheme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
