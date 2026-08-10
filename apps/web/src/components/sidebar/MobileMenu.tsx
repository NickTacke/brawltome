'use client'

import type { AccountContract } from '@brawltome/contracts'
import { BookBookmark, User } from '@solar-icons/react'
import { X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef } from 'react'

import type { PlayerShortcutNavigationItem } from '@/lib/playerShortcuts'
import { PlayerShortcutAvatar } from './PlayerShortcutAvatar'
import { useSidebar } from './SidebarProvider'
import { navItems } from './nav-items'
import { socialLinks } from './social-links'

interface MobileMenuProps {
  account: AccountContract | null
  playerShortcuts: PlayerShortcutNavigationItem[]
  shortcutsLoading: boolean
  shortcutsError: boolean
}

export function MobileMenu({ account, playerShortcuts, shortcutsLoading, shortcutsError }: MobileMenuProps) {
  const { isMobileOpen, close } = useSidebar()
  const pathname = usePathname()
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Body scroll lock while open. iOS Safari still scrolls the document behind
  // an inert <dialog>, so we keep the explicit lock as a belt.
  useEffect(() => {
    if (!isMobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isMobileOpen])

  // biome-ignore lint/correctness/useExhaustiveDependencies: isMobileOpen is a trigger, not read; the ref only populates on the render where it's true, so the effect must re-run then to call showModal.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    dialog.showModal()
  }, [isMobileOpen])

  // biome-ignore lint/correctness/useExhaustiveDependencies: same trigger pattern as the showModal effect above.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handler = () => close()
    dialog.addEventListener('close', handler)
    return () => dialog.removeEventListener('close', handler)
  }, [isMobileOpen, close])

  if (!isMobileOpen) return null

  return (
    <dialog
      id="mobile-menu"
      ref={dialogRef}
      aria-label="Main menu"
      className="animate-in fade-in bg-background fixed inset-0 z-[60] m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 p-0 text-inherit duration-150 md:hidden"
    >
      {/* Menu surface */}
      <div
        className="animate-in slide-in-from-top-2 fade-in relative flex h-full flex-col duration-200"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 24px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
          paddingLeft: 'calc(env(safe-area-inset-left) + 24px)',
          paddingRight: 'calc(env(safe-area-inset-right) + 24px)',
        }}
      >
        {/* Nav section */}
        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="bg-background sticky top-0 z-10 mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">Navigate</p>
            <button
              type="button"
              onClick={close}
              aria-label="Close menu"
              className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
            >
              <X className="h-6 w-6" strokeWidth={2} />
            </button>
          </div>
          {shortcutsLoading && (
            <output className="text-muted-foreground mb-2 block text-sm">Loading your player shortcuts...</output>
          )}
          {shortcutsError && (
            <p role="alert" className="mb-2 text-sm text-red-300">
              Player shortcuts are unavailable. All Saved Players remains available.
            </p>
          )}
          <ul className="flex flex-col">
            {navItems.map((item) => {
              const isActive = item.href === pathname
              const Icon = item.icon
              const showWipOpacity = item.wip && !isActive
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={close}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-4 border-b border-white/[0.06] py-4 text-2xl font-bold tracking-tight transition-colors ${
                      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    } ${showWipOpacity ? 'opacity-60' : ''}`}
                  >
                    <Icon
                      className={`h-6 w-6 ${isActive ? 'opacity-100' : 'opacity-60'}`}
                      weight={item.iconWeight ?? 'Linear'}
                    />
                    {item.label}
                    {item.wip && !isActive && (
                      <span className="text-muted-foreground/70 ml-auto rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                        Soon
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
          {playerShortcuts.length > 0 && (
            <div className="mt-6">
              <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-widest">Your players</p>
              <ul>
                {playerShortcuts.map((shortcut) => {
                  const active = shortcut.href === pathname
                  return (
                    <li key={`${shortcut.kind}:${shortcut.href}`}>
                      <Link
                        href={shortcut.href}
                        onClick={close}
                        aria-label={shortcut.accessibleLabel}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-12 items-center gap-4 border-b border-white/[0.06] py-3 text-lg font-semibold transition-colors ${
                          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {shortcut.kind === 'all-saved' ? (
                          <span className="flex h-8 w-8 items-center justify-center">
                            <BookBookmark className="h-6 w-6" weight="Linear" aria-hidden="true" />
                          </span>
                        ) : (
                          <PlayerShortcutAvatar avatarUrl={shortcut.avatarUrl} className="h-8 w-8 rounded-md" />
                        )}
                        {shortcut.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </nav>

        {/* Footer: socials + sign-in */}
        <div className="flex shrink-0 items-center justify-between gap-3 pt-3">
          <Link
            href="/account"
            onClick={close}
            aria-current={pathname === '/account' ? 'page' : undefined}
            className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground inline-flex items-center gap-2.5 rounded-xl px-1.5 py-2.5 text-base font-medium transition-colors"
          >
            {account?.avatarUrl ? (
              <img src={account.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <User className="h-5 w-5" weight="Linear" />
            )}
            {account ? account.displayName : 'Sign in'}
          </Link>

          <div className="flex items-center gap-1">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
              >
                {link.svg}
              </a>
            ))}
          </div>
        </div>
      </div>
    </dialog>
  )
}
