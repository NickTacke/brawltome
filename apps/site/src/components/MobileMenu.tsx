import { User } from '@solar-icons/react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { railItems, signInPath } from './AppRail'
import { socialLinks } from './social-links'

const iconButtonStyle =
  'flex size-10 items-center justify-center rounded-control text-soft transition-colors hover:bg-white/[0.04] hover:text-text'

function MenuItem({ item, onClose }: { item: (typeof railItems)[number]; onClose: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { to, label, icon: Icon, wip } = item
  const isActive = to === pathname

  return (
    <li className="border-b border-line/40 last:border-b-0">
      <Link
        to={to}
        onClick={onClose}
        aria-current={isActive ? 'page' : undefined}
        className={`flex h-14 items-center gap-4 text-lg font-bold transition-colors ${isActive ? 'text-strong' : 'text-soft hover:text-strong'} ${wip ? 'opacity-60' : ''}`}
      >
        <Icon className="size-6" weight="Linear" aria-hidden="true" />
        {label}
        {wip && <span className="ml-auto text-[11px] font-bold tracking-wide uppercase">Soon</span>}
      </Link>
    </li>
  )
}

function MenuFooter({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-t border-line/40 px-2 pt-3">
      <Link
        to={signInPath}
        onClick={onClose}
        className="flex h-10 items-center gap-2.5 font-medium text-soft hover:text-strong"
      >
        <User className="size-5" weight="Linear" aria-hidden="true" />
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
            className={iconButtonStyle}
          >
            {link.svg}
          </a>
        ))}
      </div>
    </div>
  )
}

function MenuPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  // ios safari still scrolls the page behind a modal dialog
  useEffect(() => {
    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-label="Main menu"
      onClose={onClose}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-ink p-0 text-text md:hidden"
    >
      <div className="flex h-full flex-col px-4 pt-6.5 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="flex justify-end">
          <button type="button" onClick={onClose} aria-label="Close menu" className={iconButtonStyle}>
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Primary" className="mt-2 min-h-0 flex-1 overflow-y-auto px-2">
          <ul>
            {railItems.map((item) => (
              <MenuItem key={item.to} item={item} onClose={onClose} />
            ))}
          </ul>
        </nav>

        <MenuFooter onClose={onClose} />
      </div>
    </dialog>
  )
}

export function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
        aria-expanded={isOpen}
        className={`absolute top-6.5 right-4 z-20 md:hidden ${iconButtonStyle}`}
      >
        <Menu className="size-6" aria-hidden="true" />
      </button>
      {isOpen && <MenuPanel onClose={() => setIsOpen(false)} />}
    </>
  )
}
