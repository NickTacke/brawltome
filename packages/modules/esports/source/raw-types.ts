// raw shapes as the brawltools v2 api answers them, only the fields the esports jobs read

export type RawPlayer = {
  playerId: number
  name: string
  brawlhallaId: number
}

export type RawTournament = {
  id: string
  tournamentName: string
  isOfficial: boolean
  isOnline: boolean
  startTime: number
}

export type RawPlacement = { placement: number; tournament: RawTournament }

// a mode without a power ranking comes back as rank 0 and an empty region
export type RawPr = {
  earnings: number
  pr: {
    top8: number
    top32: number
    gold: number
    silver: number
    bronze: number
    powerRanking: number
    region: string
  }
}

// brawltools ties an opponent to its start.gg and other ids too; the brawlhalla id is null or 0 when it has none
export type RawOpponent = {
  playerId?: number | null
  sggPlayerId?: number | null
  cmPlayerId?: number | null
  brawlhallaId: number | null
  name: string
}

export type RawMatch = {
  matchId: string
  scores: [number, number]
  legends: string[][]
  opponent: RawOpponent[]
  startTime?: number | null
}

export type RawLegendCount = { name: string; count: number }
