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

export interface AttachedEvent {
  event: 'attached'
}

export interface DetachedEvent {
  event: 'detached'
}

export interface ReadyEvent {
  event: 'ready'
}

export interface LocalPlayerFoundEvent {
  event: 'local_player_found'
  bhid: number
}

export type GameEvent =
  | MatchFoundEvent
  | MatchEndedEvent
  | ScanningEvent
  | AttachedEvent
  | DetachedEvent
  | ReadyEvent
  | LocalPlayerFoundEvent

export type DetectionStatus = 'idle' | 'attaching' | 'player_loaded' | 'ready'

export interface DetectionStateSnapshot {
  attached: boolean
  ready: boolean
  bhid: number | null
  matchActive: boolean
}
