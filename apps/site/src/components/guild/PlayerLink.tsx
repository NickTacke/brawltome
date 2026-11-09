import type { ReactNode } from 'react'

// a plain anchor until /player/$id exists on this site, the route types reject a Link to it
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
    <a href={`/player/${playerId}`} className={className}>
      {children}
    </a>
  )
}
