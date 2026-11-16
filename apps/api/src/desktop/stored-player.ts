import type { DesktopStandingContract } from '@brawltome/contracts'
import type {
  LeaderboardRankedStanding,
  PlayerReferenceQueries,
  PostgresLeaderboardRanked,
  RankedPlayerProfile,
  RankedPlayerQueries,
  RankedSnapshot,
} from '@brawltome/player'

export type StoredFixedTeam = DesktopStandingContract & { brawlhallaIdOne: number; brawlhallaIdTwo: number }

export type StoredPlayer = {
  brawlhallaId: number
  name: string | null
  // profile: a V0 snapshot; leaderboard: only crawled board rows; none: nothing
  source: 'profile' | 'leaderboard' | 'none'
  // no V0 refresh in the last hour (rankedFreshness is not 'fresh')
  isStale: boolean
  // the last V0 refresh, which the refresh dedupe key is built from
  lastSuccessAt: Date | null
  // when the numbers were read: the V0 refresh, else the newest leaderboard observation
  refreshedAt: Date | null
  oneVsOne: DesktopStandingContract | null
  region: string | null
  // from the V0 snapshot only
  fixedTeams: StoredFixedTeam[]
}

export type StoredPlayerReads = {
  rankedPlayers: Pick<RankedPlayerQueries, 'byId'>
  playerReferences: Pick<PlayerReferenceQueries, 'byId'>
  leaderboardStandings: Pick<PostgresLeaderboardRanked, 'standingById'>
}

type StandingValues = { rating: number; peakRating: number; tier: string | null; wins: number; games: number }

// the contract has no empty tier or region: an empty one means the source had none
export function desktopStanding(values: StandingValues): DesktopStandingContract {
  return {
    rating: values.rating,
    peakRating: values.peakRating,
    tier: values.tier || null,
    wins: values.wins,
    games: values.games,
  }
}

function fixedTeamsOf(snapshot: RankedSnapshot): StoredFixedTeam[] {
  return snapshot.fixedTeams.map((team) => ({
    ...desktopStanding(team),
    brawlhallaIdOne: team.brawlhallaIdOne,
    brawlhallaIdTwo: team.brawlhallaIdTwo,
  }))
}

function fromSnapshot(base: StoredPlayer, snapshot: RankedSnapshot): StoredPlayer {
  return {
    ...base,
    source: 'profile',
    refreshedAt: base.lastSuccessAt,
    oneVsOne: desktopStanding(snapshot.oneVsOne),
    region: snapshot.oneVsOne.region || null,
    fixedTeams: fixedTeamsOf(snapshot),
  }
}

function fromLeaderboard(base: StoredPlayer, standing: LeaderboardRankedStanding): StoredPlayer {
  return {
    ...base,
    source: 'leaderboard',
    refreshedAt: standing.observedAt,
    oneVsOne: desktopStanding(standing),
    region: standing.region || null,
  }
}

function emptyPlayer(brawlhallaId: number, name: string | null, profile: RankedPlayerProfile | null): StoredPlayer {
  return {
    brawlhallaId,
    name,
    source: 'none',
    isStale: profile?.freshness !== 'fresh',
    lastSuccessAt: profile?.lastSuccessAt ?? null,
    refreshedAt: null,
    oneVsOne: null,
    region: null,
    fixedTeams: [],
  }
}

// a rejected read rejects the whole call: a failed read must never turn into a no-data card
export async function readStoredPlayer(reads: StoredPlayerReads, brawlhallaId: number): Promise<StoredPlayer> {
  const [profile, reference] = await Promise.all([
    reads.rankedPlayers.byId(brawlhallaId),
    reads.playerReferences.byId(brawlhallaId),
  ])

  const base = emptyPlayer(brawlhallaId, reference?.name ?? null, profile)

  if (profile?.snapshot) return fromSnapshot(base, profile.snapshot)

  const standing = await reads.leaderboardStandings.standingById(brawlhallaId)

  if (standing) return fromLeaderboard(base, standing)

  return base
}

export function fixedTeamOf(player: StoredPlayer, teammateBrawlhallaId: number): StoredFixedTeam | null {
  const playerId = player.brawlhallaId

  // a team is listed with either member first
  const team = player.fixedTeams.find(
    (candidate) =>
      (candidate.brawlhallaIdOne === playerId && candidate.brawlhallaIdTwo === teammateBrawlhallaId) ||
      (candidate.brawlhallaIdOne === teammateBrawlhallaId && candidate.brawlhallaIdTwo === playerId),
  )

  return team ?? null
}
