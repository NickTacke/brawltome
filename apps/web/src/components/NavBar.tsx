'use client'

import { Button } from '@brawltome/ui'
import { ArrowLeft, Home, Menu } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useSidebar } from '@/components/sidebar/SidebarProvider'

interface NavBarProps {
  showBack?: boolean
}

export function NavBar({ showBack = false }: NavBarProps) {
  const router = useRouter()
  const { open, isMobileOpen } = useSidebar()

  return (
    <div className="flex items-center gap-2">
      {/* Mobile-only hamburger as the leftmost item. Desktop has the icon rail. */}
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

      {showBack && (
        <Button variant="ghost" onClick={() => router.back()} className="text-sm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      )}
      <Button variant="ghost" asChild className="text-sm">
        <Link href="/">
          <Home className="mr-2 h-4 w-4" />
          Home
        </Link>
      </Button>
    </div>
  )
}
