import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

// while the old site still serves some of these pages on the same domain, a link must load them from the server, or
// this app would show its own version, or its not found page, in their place
export const leavesThisApp = { reloadDocument: true } as const

type AccountLinkProps = { label?: string; className: string; onClick?: () => void; children?: ReactNode }

/** The link to the account page, which signs a visitor in when they aren't. */
export function AccountLink({ label, className, onClick, children }: AccountLinkProps) {
  return (
    <Link to="/account" {...leavesThisApp} aria-label={label} onClick={onClick} className={className}>
      {children}
    </Link>
  )
}
