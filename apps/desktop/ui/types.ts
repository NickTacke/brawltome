export interface Opponent {
  brawlhallaId: number
  name: string
  rating: number
  peakRating: number
  playtime: number // hours
  tier: string
  region: string
  legendKey: string
  winRate: number // 0-100
}

export interface MatchFoundEvent {
  event: 'match_found'
  opponents: Opponent[]
  isRanked: boolean
  localPlayerId: number
}

export interface MatchEndedEvent {
  event: 'match_ended'
}

export interface ScanningEvent {
  event: 'scanning'
}

export type GameEvent = MatchFoundEvent | MatchEndedEvent | ScanningEvent
