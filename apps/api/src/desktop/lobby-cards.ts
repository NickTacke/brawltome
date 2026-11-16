import {
  type DesktopLobbyContract,
  type DesktopLobbyInputContract,
  type DesktopStandingContract,
  parseDesktopLobbyOutput,
} from '@brawltome/contracts'
import { playersByTeam, type StoredLobby } from './read-lobby'
import { desktopStanding, fixedTeamOf, type StoredPlayer } from './stored-player'

type LobbyCard = DesktopLobbyContract['cards'][number]
type LobbyPlayer = LobbyCard['players'][number]

function lobbyPlayer(player: StoredPlayer, regionRank: number | null): LobbyPlayer {
  return {
    brawlhallaId: player.brawlhallaId,
    name: player.name,
    known: player.oneVsOne !== null,
    oneVsOne: player.oneVsOne,
    region: player.region,
    regionRank,
    refreshedAt: player.refreshedAt?.toISOString() ?? null,
    // the route sets it for players whose refresh it queued
    isRefreshing: false,
  }
}

function oneVsOneCards(input: DesktopLobbyInputContract, stored: StoredLobby): LobbyCard[] {
  return input.players.map((sent, index) => {
    const player = stored.players[index]
    const regionRank = stored.regionRanks.get(player.brawlhallaId) ?? null

    return { team: sent.team, players: [lobbyPlayer(player, regionRank)], teamStanding: null }
  })
}

function lastSuccessMs(player: StoredPlayer): number {
  return player.lastSuccessAt?.getTime() ?? 0
}

// the newest V0 profile of the pair decides, so an older profile can't bring back a team the newer one dropped
function teamStandingOf(
  members: StoredPlayer[],
  observedTeam: DesktopStandingContract | null,
): DesktopStandingContract | null {
  if (members.length !== 2) return null

  const [first, second] = members
  const isSecondNewer = lastSuccessMs(second) > lastSuccessMs(first)
  const latest = isSecondNewer ? second : first
  const teammate = isSecondNewer ? first : second
  const fixedTeam = fixedTeamOf(latest, teammate.brawlhallaId)

  if (fixedTeam) return desktopStanding(fixedTeam)

  return observedTeam
}

function teamCards(input: DesktopLobbyInputContract, stored: StoredLobby): LobbyCard[] {
  const membersByTeam = playersByTeam(stored.players, input)

  return [...membersByTeam].map(([team, members]) => ({
    team,
    players: members.map((member) => lobbyPlayer(member, null)),
    teamStanding: teamStandingOf(members, stored.observedTeams.get(team) ?? null),
  }))
}

export function buildLobbyCards(input: DesktopLobbyInputContract, stored: StoredLobby): DesktopLobbyContract {
  const cards = input.matchType === '1v1' ? oneVsOneCards(input, stored) : teamCards(input, stored)

  return parseDesktopLobbyOutput({ cards })
}
