'use client'

import { Button } from '@brawltome/ui'
import { Menu } from 'lucide-react'

import { useSidebar } from './SidebarProvider'

/**
 * Inline hamburger button for the top of the home page on mobile. Scrolls with
 * content (not fixed). Matches the NavBar hamburger on sub-pages for visual
 * consistency across the app.
 */
export function MobileFloatingMenuButton() {
  const { open, isMobileOpen } = useSidebar()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={open}
      aria-label="Open menu"
      aria-expanded={isMobileOpen}
      aria-controls="mobile-menu"
      className="md:hidden"
    >
      <Menu className="h-5 w-5" />
    </Button>
  )
}
