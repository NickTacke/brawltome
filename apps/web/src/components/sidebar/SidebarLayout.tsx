'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { CommandPalette } from '@/components/CommandPalette'
import { AppSidebar } from './AppSidebar'
import { MobileMenu } from './MobileMenu'
import { MobileMenuButton } from './MobileMenuButton'

export function SidebarLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isHome = pathname === '/'

  return (
    <>
      <CommandPalette />

      {/* Mobile chrome is shell-owned so every route exposes exactly one menu trigger. */}
      <MobileMenu />

      {/* Fixed desktop sidebar - does not affect content flow. h-dvh gives the
          AppSidebar (which uses h-full) a proper container height. */}
      <div className="hidden md:block fixed left-0 top-0 z-30 h-dvh">
        <AppSidebar />
      </div>

      {/* Reserve the sidebar width at md+ so content never sits underneath the
          fixed sidebar. Below md the sidebar is hidden (mobile menu only),
          so no offset is needed. Home renders its own full-width layout
          (search + leaderboard centered within the remaining area); all other
          pages use the shared max-w-6xl content wrapper. */}
      <div className="md:pl-[57px]">
        <div className={isHome ? 'flex pl-5 pt-5 md:hidden' : 'mx-auto flex max-w-6xl px-6 pt-5 md:hidden'}>
          <MobileMenuButton />
        </div>
        {isHome ? (
          children
        ) : (
          <main className="min-h-screen">
            <div className="mx-auto max-w-6xl px-6 pt-4 pb-6 sm:pt-6 md:pt-10">{children}</div>
          </main>
        )}
      </div>
    </>
  )
}
