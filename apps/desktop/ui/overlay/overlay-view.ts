// what the overlay page draws, as the app sends it; the rust side serializes the same shape

import type { PostMatchView } from './post-match'

export type FailureReason = 'offline' | 'rateLimited' | 'unavailable' | 'updateRequired' | 'rejected'

export type PlayerHead = { brawlhallaId: number; name: string; legend: string | null }

// what the game's memory holds of a player in a ranked match: the 1v1 elo, or the own 2v2 elo in a 2v2
export type Known = { rating: number; games: number }

export type Failed = { state: 'failed'; reason: FailureReason; retryInSeconds: number | null; canRetry: boolean }

export type CardData =
  | { state: 'loading' }
  | {
      state: 'ranked'
      tier: string | null
      rating: number
      peakRating: number
      regionRank: number | null
      wins: number
      games: number
      isRefreshing: boolean
    }
  | { state: 'noRankedData' }
  | Failed

export type TeamData =
  | { state: 'loading' }
  | {
      state: 'ready'
      standing: { tier: string | null; rating: number; peakRating: number; wins: number; games: number } | null
      isRefreshing: boolean
    }
  | Failed

export type TeamPlayer = PlayerHead & { known: Known | null; oneVsOneRating: number | null }

export type StatusView =
  | { state: 'connecting' }
  | { state: 'ready'; patch: string }
  | { state: 'unsupported'; patch: string | null }

export type Card =
  | { kind: 'solo'; player: PlayerHead; known: Known | null; data: CardData }
  | { kind: 'team'; team: number; data: TeamData; players: TeamPlayer[] }
  | { kind: 'teammate'; player: PlayerHead; known: Known | null }
  | ({ kind: 'postMatch' } & PostMatchView)
  | { kind: 'status'; status: StatusView }

export type OverlayView = { lobbyId: number; cards: Card[]; visibleMs: number }
