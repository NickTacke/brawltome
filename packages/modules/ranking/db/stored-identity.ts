import type { PublishedLeaderboardIdentity } from '../leaderboard'

export type StoredIdentityRow = {
  identity_kind: PublishedLeaderboardIdentity['type']
  player_one_id: number
  player_one_name: string
  player_two_id: number | null
  player_two_name: string | null
}

/** Turns the identity columns a board row stores back into the identity it was published with. */
export function publishedIdentity(row: StoredIdentityRow): PublishedLeaderboardIdentity {
  const first = { brawlhallaId: row.player_one_id, name: row.player_one_name }

  if (row.identity_kind === 'fixed-two-vs-two-team') {
    if (row.player_two_id === null || row.player_two_name === null) throw new Error('stored fixed team is incomplete')

    return {
      type: row.identity_kind,
      players: [first, { brawlhallaId: row.player_two_id, name: row.player_two_name }],
    }
  }

  if (row.player_two_id !== null || row.player_two_name !== null)
    throw new Error('stored player identity has a teammate')

  if (row.identity_kind === 'one-vs-one-player') return { type: row.identity_kind, player: first }

  if (row.identity_kind === 'solo-two-vs-two-player') return { type: row.identity_kind, player: first }

  if (row.identity_kind === 'three-vs-three-player') return { type: row.identity_kind, player: first }

  throw new Error('stored leaderboard identity is unsupported')
}
