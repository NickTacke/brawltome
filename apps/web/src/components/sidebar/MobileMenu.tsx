'use client'

import { User } from '@solar-icons/react'
import { X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef } from 'react'

import { useSidebar } from './SidebarProvider'
import { navItems } from './nav-items'
import { socialLinks } from './social-links'

/**
 * Full-screen mobile navigation menu. Self-gates on isMobileOpen so it can be
 * mounted unconditionally by the layout. Desktop hides it entirely via md:hidden.
 */
export function MobileMenu() {
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
        <nav aria-label="Primary">
          <div className="mb-3 flex items-center justify-between">
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
          <ul className="flex flex-col">
            {navItems.map((item) => {
              const isActive = item.href === pathname
              const Icon = item.icon
              const showWipOpacity = item.wip && !isActive
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
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
        </nav>

        {/* Spacer — tapping here passes through to the backdrop click handler
            because this div has no pointer-capturing content. */}
        <div className="flex-1" />

        {/* Footer: socials + sign-in */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/account"
            className="text-muted-foreground hover:bg-white/[0.04] hover:text-foreground inline-flex items-center gap-2.5 rounded-xl px-1.5 py-2.5 text-base font-medium transition-colors"
          >
            <User className="h-5 w-5" weight="Linear" />
            Sign in
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
