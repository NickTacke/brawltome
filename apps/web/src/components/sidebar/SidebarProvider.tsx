'use client'

import { usePathname } from 'next/navigation'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react'

interface SidebarContextValue {
  isMobileOpen: boolean
  open: () => void
  close: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const pathname = usePathname()

  const open = useCallback(() => setIsMobileOpen(true), [])
  const close = useCallback(() => setIsMobileOpen(false), [])

  // Auto-close the mobile menu on route change so individual nav triggers
  // don't each have to call close().
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger, not read in the body.
  useEffect(() => {
    setIsMobileOpen(false)
  }, [pathname])

  return <SidebarContext value={{ isMobileOpen, open, close }}>{children}</SidebarContext>
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}
