import type { LeaderboardIdentity } from '@brawltome/contracts'

export type EntryPlayer = { brawlhallaId: number; name: string; bestLegendNameKey?: string | null }

/** Everyone on one leaderboard row: two players for a 2v2 team, one for every other bracket. */
export function entryPlayers(entry: { identity: LeaderboardIdentity }): EntryPlayer[] {
  const { identity } = entry

  if (identity.type === 'fixed-two-vs-two-team') return [...identity.players]

  return [identity.player]
}
