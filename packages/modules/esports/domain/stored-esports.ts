import type { RawMatch, RawPr } from '../source/raw-types'

// one row of esports.placements; mode is 1 for 1v1 and 2 for 2v2
export type StoredPlacement = {
  mode: 1 | 2
  tournamentId: string
  tournamentName: string
  isOfficial: boolean
  isOnline: boolean
  startTime: Date
  placement: number
}

// what the storage hands back for one player: the raw power rankings, the placements and the raw sets of each event,
// keyed by tournament id with the player's side first
export type StoredEsports = {
  pr1v1: RawPr | null
  pr2v2: RawPr | null
  placements: StoredPlacement[]
  setsByTournament: Map<string, RawMatch[]>
}
