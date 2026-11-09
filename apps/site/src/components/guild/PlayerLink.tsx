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
    <Link to="/player/$id" params={{ id: String(playerId) }} className={className}>
      {children}
    </Link>
  )
}
