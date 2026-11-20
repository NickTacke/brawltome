import type {
  PlayerRankedProfileContract,
  PlayerReferenceContract,
  PrimaryPlayerVerificationStateContract,
} from '@brawltome/contracts'
import { fixEncoding } from '../../lib'

/** A pinned player as a row shows it. Every fact but the id is missing when the site has never stored the player. */
export type PinnedPlayerRow = {
  brawlhallaId: number
  name: string | null
  legendNameKey: string | null
  region: string | null
  tier: string | null
  rating: number | null
  peakRating: number | null
  wins: number
  games: number
}

/** A player's name as the site shows it, or the id when the site has never stored the player. */
export function playerLabel(player: Pick<PinnedPlayerRow, 'brawlhallaId' | 'name'>): string {
  return player.name ? fixEncoding(player.name) : `Player ${player.brawlhallaId}`
}

export type Verification =
  | { status: 'verified'; player: PinnedPlayerRow }
  | { status: 'pending' }
  | { status: 'stalled' }
  | { status: 'failed' }
  | { status: 'conflict' }
  | { status: 'unverified' }

export type SignedInAccount = {
  displayName: string
  avatarUrl: string | null
  createdAt: string
}

export type AccountPage =
  | { kind: 'signedOut'; signInUrl: string }
  | {
      kind: 'signedIn'
      account: SignedInAccount
      verification: Verification
      // every pin but the verified account, in the stored order
      pins: PinnedPlayerRow[]
      // the stored order of every pin, which a reorder has to send back whole
      pinOrder: number[]
      verifySteamUrl: string
    }

export type PlayerFacts = {
  reference: PlayerReferenceContract | null
  ranked: PlayerRankedProfileContract | null
}

export function toPinnedPlayerRow(brawlhallaId: number, facts: PlayerFacts | undefined): PinnedPlayerRow {
  const oneVsOne = facts?.ranked?.snapshot?.oneVsOne
  const mainLegend = facts?.ranked?.snapshot?.mainLegend?.legendNameKey

  return {
    brawlhallaId,
    name: facts?.reference?.name ?? null,
    legendNameKey: mainLegend ?? facts?.reference?.bestLegendNameKey ?? null,
    region: oneVsOne?.region ?? null,
    tier: oneVsOne?.tier ?? null,
    rating: oneVsOne?.rating ?? null,
    peakRating: oneVsOne?.peakRating ?? null,
    wins: oneVsOne?.wins ?? 0,
    games: oneVsOne?.games ?? 0,
  }
}

// a check finishes within a few minutes, so one still pending after this is stuck and the visitor should try again
const stalledAfterMs = 15 * 60 * 1000

/** The verified account wins over any later attempt; without one, the latest attempt says where verification is. */
export function toVerification(
  state: PrimaryPlayerVerificationStateContract,
  factsById: ReadonlyMap<number, PlayerFacts>,
  now: Date,
): Verification {
  const primaryPlayer = state.primaryPlayer

  if (primaryPlayer) {
    const row = toPinnedPlayerRow(primaryPlayer.brawlhallaId, factsById.get(primaryPlayer.brawlhallaId))

    return { status: 'verified', player: { ...row, name: row.name ?? primaryPlayer.name } }
  }

  const latest = state.attempts[0]

  if (latest?.status === 'pending') {
    const pendingMs = now.getTime() - Date.parse(latest.startedAt)

    return { status: pendingMs > stalledAfterMs ? 'stalled' : 'pending' }
  }

  if (latest?.status === 'failed' || latest?.status === 'conflict') return { status: latest.status }

  return { status: 'unverified' }
}

// a failure is never explained to the page; the server log has the detail
export type PinWriteAnswer = { kind: 'saved'; pinOrder: number[] } | { kind: 'signedOut' } | { kind: 'failed' }

export type SignOutAnswer = { kind: 'signedOut' } | { kind: 'failed' }
