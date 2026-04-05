"use client";

import { Menu } from "lucide-react";
import Link from "next/link";

import { Button } from "@brawltome/ui";

import { useSidebar } from "./SidebarProvider";

export function MobileTopBar() {
  const { open } = useSidebar();

  return (
    <div className="bg-sidebar border-sidebar-border flex items-center justify-between border-b px-3 py-2 md:hidden">
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

      {/* Spacer to balance the hamburger on the left so the logo text stays centered */}
      <div className="h-8 w-8" aria-hidden="true" />
    </div>
  );
}
