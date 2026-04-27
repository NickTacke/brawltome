import type React from 'react'
import { fixEncoding } from '../../lib/utils'

export type Command =
  | { kind: 'nav'; id: string; label: string; href: string; icon: React.ReactNode }
  | {
      kind: 'player'
      id: string
      label: string
      region: string | null
      rating: number
      bestLegendNameKey?: string | null
      matchedAlias?: string | null
      href: string
    }
  | { kind: 'clan'; id: string; label: string; href: string }

export interface PlayerSearchResult {
  brawlhallaId: number
  name: string
  region: string | null
  rating: number
  bestLegendNameKey?: string | null
  matchedAlias?: string | null
}

export interface ClanSearchResult {
  clanId: number
  clanName: string
}

export interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string; weight?: string }>
  iconWeight?: string
}

export function buildCommands(deps: {
  isSearchMode: boolean
  navItems: NavItem[]
  playerResults: PlayerSearchResult[]
  clanResults: ClanSearchResult[]
}): Command[] {
  if (!deps.isSearchMode) {
    return deps.navItems.map((item) => {
      const Icon = item.icon
      return {
        kind: 'nav' as const,
        id: `nav-${item.href}`,
        label: item.label,
        href: item.href,
        icon: <Icon className="h-5 w-5" weight={item.iconWeight ?? 'Linear'} />,
      }
    })
  }
  const players: Command[] = deps.playerResults.map((p) => ({
    kind: 'player' as const,
    id: `p-${p.brawlhallaId}`,
    label: fixEncoding(p.name),
    region: p.region,
    rating: p.rating,
    bestLegendNameKey: p.bestLegendNameKey,
    matchedAlias: p.matchedAlias ? fixEncoding(p.matchedAlias) : null,
    href: `/player/${p.brawlhallaId}`,
  }))
  const clans: Command[] = deps.clanResults.map((c) => ({
    kind: 'clan' as const,
    id: `c-${c.clanId}`,
    label: fixEncoding(c.clanName),
    href: `/clan/${c.clanId}`,
  }))
  return [...players, ...clans]
}

export function isNumericPlayerId(query: string): boolean {
  return /^\d{5,}$/.test(query.trim())
}
