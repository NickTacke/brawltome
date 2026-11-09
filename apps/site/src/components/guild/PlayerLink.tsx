import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function PlayerLink({
  playerId,
  className,
  children,
}: {
  playerId: number
  className: string
  children: ReactNode
}) {
  return (
    // a roster has dozens of rows, and each preloaded player page is six internal reads
    <Link to="/player/$id" params={{ id: String(playerId) }} preload={false} className={className}>
      {children}
    </Link>
  )
}
