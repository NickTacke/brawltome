import type { DesktopLobbyInputContract, DesktopStandingContract } from '@brawltome/contracts'
import type { PostgresLeaderboardRanked } from '@brawltome/player'
import { type RegionalLeaderboardScope, regionalLeaderboardScopes } from '@brawltome/ranking'
import { desktopStanding, readStoredPlayer, type StoredPlayer, type StoredPlayerReads } from './stored-player'

export type LobbyReads = StoredPlayerReads & {
  leaderboardStandings: Pick<PostgresLeaderboardRanked, 'standingById' | 'teamStandingByPair'>
  readBoardRanks(input: {
    brawlhallaId: number
    region: RegionalLeaderboardScope
  }): Promise<{ regionRank: number | null }>
}

export type StoredLobby = {
  // in the order sent
  players: StoredPlayer[]
  // 1v1 only, by brawlhalla id
  regionRanks: ReadonlyMap<number, number>
  // 2v2 only, by team value
  observedTeams: ReadonlyMap<number, DesktopStandingContract>
}

function isRegionalScope(region: string | null): region is RegionalLeaderboardScope {
  return regionalLeaderboardScopes.some((scope) => scope === region)
}

async function readRegionRank(reads: LobbyReads, player: StoredPlayer): Promise<number | null> {
  const region = player.region

  if (!isRegionalScope(region)) return null

  const boardRanks = await reads.readBoardRanks({ brawlhallaId: player.brawlhallaId, region })

  return boardRanks.regionRank
}

async function readRegionRanks(reads: LobbyReads, players: StoredPlayer[]): Promise<Map<number, number>> {
  const ranks = await Promise.all(players.map((player) => readRegionRank(reads, player)))
  const regionRanks = new Map<number, number>()

  players.forEach((player, index) => {
    const regionRank = ranks[index]

    if (regionRank !== null) regionRanks.set(player.brawlhallaId, regionRank)
  })

  return regionRanks
}

// grouped in first-seen team order, players in the order sent
export function playersByTeam(players: StoredPlayer[], input: DesktopLobbyInputContract): Map<number, StoredPlayer[]> {
  const teams = new Map<number, StoredPlayer[]>()

  input.players.forEach((sent, index) => {
    const members = teams.get(sent.team) ?? []

    members.push(players[index])
    teams.set(sent.team, members)
  })

  return teams
}

// a profile that doesn't list the pair is newer evidence than an old board row, so the board is only asked when
// neither member has one
async function readObservedTeam(reads: LobbyReads, members: StoredPlayer[]): Promise<DesktopStandingContract | null> {
  if (members.length !== 2) return null

  if (members.some((member) => member.source === 'profile')) return null

  const [one, two] = members
  const team = await reads.leaderboardStandings.teamStandingByPair(one.brawlhallaId, two.brawlhallaId)

  if (!team) return null

  return desktopStanding(team)
}

async function readObservedTeams(
  reads: LobbyReads,
  players: StoredPlayer[],
  input: DesktopLobbyInputContract,
): Promise<Map<number, DesktopStandingContract>> {
  const teams = [...playersByTeam(players, input)]

  const standings = await Promise.all(
    teams.map(async ([team, members]) => [team, await readObservedTeam(reads, members)] as const),
  )

  const observedTeams = new Map<number, DesktopStandingContract>()

  for (const [team, standing] of standings) {
    if (standing) observedTeams.set(team, standing)
  }

  return observedTeams
}

// any rejected read rejects the lobby, so the route answers 503 instead of cards built on missing data
export async function readStoredLobby(reads: LobbyReads, input: DesktopLobbyInputContract): Promise<StoredLobby> {
  const players = await Promise.all(input.players.map((player) => readStoredPlayer(reads, player.brawlhallaId)))

  if (input.matchType === '1v1') {
    const regionRanks = await readRegionRanks(reads, players)

    return { players, regionRanks, observedTeams: new Map() }
  }

  const observedTeams = await readObservedTeams(reads, players, input)

  return { players, regionRanks: new Map(), observedTeams }
}
