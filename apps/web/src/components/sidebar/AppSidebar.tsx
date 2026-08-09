'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@brawltome/ui'
import { User } from '@solar-icons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useMe } from '@/lib/auth'
import { navItems } from './nav-items'
import { socialLinks } from './social-links'

// Fixed sidebar width. The bar is never collapsible or extendable — labels
// appear as tooltips on hover instead.
// 57 = 1px border-r + 8px nav padding + 40px icon tile + 8px nav padding.
// The extra pixel compensates for the 1px right border (box-sizing: border-box
// eats it from the content area) so icons sit exactly centered in the visible
// sidebar area.
export const SIDEBAR_WIDTH = 57

function WithTooltip({
  label,
  children,
}: {
  label: ReactNode
  children: ReactNode
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Desktop-only icon-rail sidebar. Hidden on mobile via its container in
 * SidebarLayout. Mobile uses the separate MobileMenu component.
 */
export function AppSidebar() {
  const pathname = usePathname()
  const { user } = useMe()

  return (
    <TooltipProvider>
      <aside
        className="bg-sidebar border-sidebar-border text-sidebar-foreground flex h-full flex-col overflow-hidden border-r"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <div className="px-2 pt-2">
          <WithTooltip label="BrawlTome">
            <Link
              href="/"
              aria-label="BrawlTome home"
              className="flex h-10 w-10 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
            >
              <img src="/images/logo.png" alt="" className="h-8 w-8" />
            </Link>
          </WithTooltip>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => {
            const isActive = item.href === pathname
            const Icon = item.icon
            const tooltipLabel: ReactNode = item.wip ? (
              <span className="flex items-center gap-2">
                {item.label}
                <span className="text-muted-foreground/70 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  Soon
                </span>
              </span>
            ) : (
              item.label
            )
            const showWipOpacity = item.wip && !isActive
            return (
              <WithTooltip key={item.href} label={tooltipLabel}>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`my-2 flex w-10 items-center rounded-lg transition-colors ${
                    isActive
                      ? 'text-foreground bg-white/[0.08]'
                      : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                  } ${showWipOpacity ? 'opacity-60 hover:opacity-80' : ''}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                    <Icon className="h-6 w-6" weight={item.iconWeight ?? 'Linear'} />
                  </div>
                </Link>
              </WithTooltip>
            )
          })}
        </nav>

        <div className="border-sidebar-border shrink-0 border-t px-2 py-2">
          <div className="mb-2">
            {socialLinks.map((link) => (
              <WithTooltip key={link.label} label={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground my-1 flex w-10 items-center rounded-lg transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center">{link.svg}</div>
                </a>
              </WithTooltip>
            ))}
          </div>

          <div className="border-sidebar-border border-t pt-2 pb-1">
            <WithTooltip label={user ? user.username : 'Sign in'}>
              <Link
                href="/account"
                aria-label={user ? 'Account' : 'Sign in'}
                aria-current={pathname === '/account' ? 'page' : undefined}
                className="group flex w-10 items-center rounded-lg"
              >
                <div className="bg-sidebar-accent text-muted-foreground border-sidebar group-hover:brightness-150 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 transition-all">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-6 w-6" weight="Linear" />
                  )}
                </div>
              </Link>
            </WithTooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
