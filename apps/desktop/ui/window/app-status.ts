// what the main window draws, as the app sends it; the rust side serializes the same shape

import type { PlayerHead } from '../overlay/overlay-view'

export type GameStatus = { state: 'notRunning' } | { state: 'running'; gameVersion: string | null }

export type DetectionStatus =
  | { state: 'waiting' }
  | { state: 'starting' }
  | { state: 'ready' }
  | { state: 'unsupported'; message: string }

export type ServiceStatus =
  | { state: 'ok' }
  | { state: 'offline' }
  | { state: 'unavailable' }
  | { state: 'updateRequired'; minimumVersion: string }

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string }
  | { state: 'readyWhenGameCloses'; version: string }

// isWin and ratingChange stay null until the app reads how the match ended
export type RecentMatch = {
  startedAtMs: number
  opponents: PlayerHead[]
  isWin: boolean | null
  ratingChange: number | null
}

// the player's own 1v1 standing, from the game's memory
export type OwnStanding = { name: string; legend: string | null; rating: number; games: number }

export type AppStatus = {
  game: GameStatus
  detection: DetectionStatus
  service: ServiceStatus
  update: UpdateStatus
  isOverlayPaused: boolean
  isMatchRunning: boolean
  you: OwnStanding | null
  recentMatches: RecentMatch[]
}

export type OverlayPosition =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'middleLeft'
  | 'center'
  | 'middleRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight'

export type Settings = { overlayPosition: OverlayPosition; startsWithWindows: boolean }
