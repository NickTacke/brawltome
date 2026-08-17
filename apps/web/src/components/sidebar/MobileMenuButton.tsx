'use client'

import { Button } from '@/components/ui'
import { Menu } from 'lucide-react'

import { useSidebar } from './SidebarProvider'

/** Shell-owned mobile menu trigger. It stays in content flow rather than floating. */
export function MobileMenuButton() {
  const { open, isMobileOpen } = useSidebar()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={open}
      aria-label="Open menu"
      aria-expanded={isMobileOpen}
      aria-controls={isMobileOpen ? 'mobile-menu' : undefined}
      className="md:hidden"
    >
      <Menu className="h-5 w-5" />
    </Button>
  )
}
