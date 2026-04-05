"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface SidebarContextValue {
  isMobileOpen: boolean;
  open: () => void;
  close: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const pathname = usePathname();

  const open = useCallback(() => setIsMobileOpen(true), []);
  const close = useCallback(() => setIsMobileOpen(false), []);

  // Auto-close the mobile menu on any route change. Ensures that tapping a
  // nav item inside the menu navigates and then the menu gets out of the way
  // without each trigger having to call close() manually.
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  return (
    <SidebarContext value={{ isMobileOpen, open, close }}>
      {children}
    </SidebarContext>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
