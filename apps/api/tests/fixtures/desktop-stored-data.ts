import type { DesktopStandingContract } from '@brawltome/contracts'
import type { LeaderboardRankedStanding, LeaderboardTeamStanding, RankedPlayerProfile } from '@brawltome/player'
import type { RegionalLeaderboardScope } from '@brawltome/ranking'
import type { LobbyReads } from '../../src/desktop/read-lobby'

type ProfileSnapshot = NonNullable<RankedPlayerProfile['snapshot']>
type SnapshotFixedTeam = ProfileSnapshot['fixedTeams'][number]

export type ProfileInput = {
  brawlhallaId: number
  lastSuccessAt: Date
  freshness?: RankedPlayerProfile['freshness']
  oneVsOne: DesktopStandingContract & { tier: string }
  region: string
  fixedTeams?: SnapshotFixedTeam[]
}

export function rankedProfile(input: ProfileInput): RankedPlayerProfile {
  return {
    brawlhallaId: input.brawlhallaId,
    checkedAt: input.lastSuccessAt,
    lastSuccessAt: input.lastSuccessAt,
    freshness: input.freshness ?? 'fresh',
    freshForSeconds: 3600,
    sparsePulse: null,
    snapshot: {
      oneVsOne: { ...input.oneVsOne, region: input.region, globalRank: 1200, regionRank: 9 },
      rankedLegends: [],
      mainLegend: null,
      fixedTeams: input.fixedTeams ?? [],
      soloQueue: [],
      ratingHistory: [],
      observedRatingDirection: null,
    },
  }
}

export function snapshotFixedTeam(
  brawlhallaIdOne: number,
  brawlhallaIdTwo: number,
  standing: DesktopStandingContract & { tier: string },
): SnapshotFixedTeam {
  return { ...standing, brawlhallaIdOne, brawlhallaIdTwo, teamName: 'Team', region: 'EU', globalRank: null }
}

export type StoredData = {
  profiles?: RankedPlayerProfile[]
  names?: Record<number, string>
  standings?: LeaderboardRankedStanding[]
  teams?: LeaderboardTeamStanding[]
  regionRanks?: Record<number, number>
}

export type ReadCalls = {
  standingById: number[]
  teamStandingByPair: [number, number][]
  readBoardRanks: { brawlhallaId: number; region: RegionalLeaderboardScope }[]
}

function teamOf(teams: LeaderboardTeamStanding[], brawlhallaIdOne: number, brawlhallaIdTwo: number) {
  const lowerId = Math.min(brawlhallaIdOne, brawlhallaIdTwo)
  const higherId = Math.max(brawlhallaIdOne, brawlhallaIdTwo)
  const team = teams.find((entry) => entry.brawlhallaIdOne === lowerId && entry.brawlhallaIdTwo === higherId)

  return team ?? null
}

// in-memory reads over the given rows, recording the leaderboard and board calls the tests assert on
export function fakeLobbyReads(data: StoredData): { reads: LobbyReads; calls: ReadCalls } {
  const calls: ReadCalls = { standingById: [], teamStandingByPair: [], readBoardRanks: [] }
  const profiles = data.profiles ?? []
  const standings = data.standings ?? []

  const reads: LobbyReads = {
    rankedPlayers: {
      byId: async (brawlhallaId) => profiles.find((profile) => profile.brawlhallaId === brawlhallaId) ?? null,
    },
    playerReferences: {
      byId: async (brawlhallaId) => {
        const name = data.names?.[brawlhallaId]

        return name ? { brawlhallaId, name, aliases: [] } : null
      },
    },
    leaderboardStandings: {
      standingById: async (brawlhallaId) => {
        calls.standingById.push(brawlhallaId)

        return standings.find((standing) => standing.brawlhallaId === brawlhallaId) ?? null
      },
      teamStandingByPair: async (brawlhallaIdOne, brawlhallaIdTwo) => {
        calls.teamStandingByPair.push([brawlhallaIdOne, brawlhallaIdTwo])

        return teamOf(data.teams ?? [], brawlhallaIdOne, brawlhallaIdTwo)
      },
    },
    readBoardRanks: async (input) => {
      calls.readBoardRanks.push(input)

      return { regionRank: data.regionRanks?.[input.brawlhallaId] ?? null }
    },
  }

  return { reads, calls }
}
