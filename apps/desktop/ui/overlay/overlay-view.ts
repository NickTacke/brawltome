// what the overlay page draws, as the app sends it; the rust side serializes the same shape

import type { PostMatchView } from './post-match'

export type FailureReason = 'offline' | 'rateLimited' | 'unavailable' | 'updateRequired' | 'rejected'

export type PlayerHead = { brawlhallaId: number; name: string; legend: string | null }

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

export type TeamPlayer = PlayerHead & { personalRating2v2: number | null; oneVsOneRating: number | null }

export type Card =
  | { kind: 'solo'; player: PlayerHead; data: CardData }
  | { kind: 'team'; team: number; data: TeamData; players: TeamPlayer[] }
  | ({ kind: 'postMatch' } & PostMatchView)

export type OverlayView = { lobbyId: number; cards: Card[]; visibleMs: number }
