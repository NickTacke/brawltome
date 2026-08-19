'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui'
import type { AccountContract } from '@brawltome/contracts'
import { User } from '@solar-icons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import type { PlayerShortcutNavigationItem } from '@/lib/playerShortcuts'
import { PlayerShortcutAvatar } from './PlayerShortcutAvatar'
import { navItems } from './nav-items'
import { socialLinks } from './social-links'

const SIDEBAR_WIDTH = 57

function RailTooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

interface AppSidebarProps {
  account: AccountContract | null
  playerShortcuts: PlayerShortcutNavigationItem[]
  shortcutsLoading: boolean
  shortcutsError: boolean
}

export function AppSidebar({ account, playerShortcuts, shortcutsLoading, shortcutsError }: AppSidebarProps) {
  const pathname = usePathname()
  const primaryShortcut = playerShortcuts.find(({ kind }) => kind === 'primary')
  const pinnedShortcuts = playerShortcuts.filter(({ kind }) => kind === 'pin')

  return (
    <TooltipProvider>
      <aside
        className="bg-sidebar border-sidebar-border text-sidebar-foreground flex h-full flex-col overflow-hidden border-r"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <nav className="shrink-0 px-2 py-1">
          {shortcutsLoading && <span className="sr-only">Loading your player shortcuts.</span>}
          {shortcutsError && (
            <span role="alert" className="sr-only">
              Player shortcuts are unavailable.
            </span>
          )}
          {navItems.map((item) => {
            const active = item.href === pathname
            const Icon = item.icon
            return (
              <RailTooltip key={item.href} label={`${item.label}${item.wip ? ' (Soon)' : ''}`}>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  className={`my-2 flex w-10 items-center rounded-lg transition-colors ${
                    active
                      ? 'text-foreground bg-white/[0.08]'
                      : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                  } ${item.wip && !active ? 'opacity-60 hover:opacity-80' : ''}`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                    <Icon className="h-6 w-6" weight={item.iconWeight ?? 'Linear'} aria-hidden="true" />
                  </span>
                </Link>
              </RailTooltip>
            )
          })}
          {primaryShortcut && (
            <div className="border-sidebar-border mt-2 border-t pt-2">
              <RailTooltip label={primaryShortcut.label}>
                <Link
                  href={primaryShortcut.href}
                  aria-label={primaryShortcut.accessibleLabel}
                  aria-current={primaryShortcut.href === pathname ? 'page' : undefined}
                  className={`my-2 flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                    primaryShortcut.href === pathname
                      ? 'text-foreground bg-white/[0.08]'
                      : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                  }`}
                >
                  <PlayerShortcutAvatar avatarUrl={primaryShortcut.avatarUrl} className="h-8 w-8 rounded-md" />
                </Link>
              </RailTooltip>
            </div>
          )}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {pinnedShortcuts.length > 0 && (
            <ul aria-label="Pinned Players" className="pt-2">
              {pinnedShortcuts.map((shortcut) => {
                const active = shortcut.href === pathname
                return (
                  <li key={`${shortcut.kind}:${shortcut.href}`}>
                    <RailTooltip label={shortcut.label}>
                      <Link
                        href={shortcut.href}
                        aria-label={shortcut.accessibleLabel}
                        aria-current={active ? 'page' : undefined}
                        className={`my-2 flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                          active
                            ? 'text-foreground bg-white/[0.08]'
                            : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                        }`}
                      >
                        <PlayerShortcutAvatar avatarUrl={shortcut.avatarUrl} className="h-8 w-8 rounded-md" />
                      </Link>
                    </RailTooltip>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-sidebar-border shrink-0 border-t px-2 py-2">
          <div className="mb-2">
            {socialLinks.map((link) => (
              <RailTooltip key={link.label} label={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground my-1 flex w-10 items-center rounded-lg transition-colors"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center">{link.svg}</span>
                </a>
              </RailTooltip>
            ))}
          </div>

          <div className="border-sidebar-border border-t pt-2 pb-1">
            <RailTooltip label={account ? account.displayName : 'Sign in'}>
              <Link
                href="/account"
                aria-label={account ? 'Account' : 'Sign in'}
                aria-current={pathname === '/account' ? 'page' : undefined}
                className="group flex w-10 items-center rounded-lg"
              >
                <span className="bg-sidebar-accent text-muted-foreground border-sidebar group-hover:brightness-150 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 transition-all">
                  {account?.avatarUrl ? (
                    <img src={account.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-6 w-6" weight="Linear" aria-hidden="true" />
                  )}
                </span>
              </Link>
            </RailTooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
