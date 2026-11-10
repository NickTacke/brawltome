import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

type AccountLinkProps = { label?: string; className: string; onClick?: () => void; children?: ReactNode }

/** The link to the account page, which signs a visitor in when they aren't. */
export function AccountLink({ label, className, onClick, children }: AccountLinkProps) {
  return (
    <Link to="/account" aria-label={label} onClick={onClick} className={className}>
      {children}
    </Link>
  )
}
