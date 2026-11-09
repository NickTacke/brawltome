import type { PlayerRankedProfileContract } from '@brawltome/contracts'
import { fixEncoding } from '../../lib'
import { bestRating, winPercent } from './player-format'

type RankedSnapshot = NonNullable<PlayerRankedProfileContract['snapshot']>

export type FixedTeam = RankedSnapshot['fixedTeams'][number]
export type SoloQueueEntry = RankedSnapshot['soloQueue'][number]
export type OneVsOne = RankedSnapshot['oneVsOne']
export type Standing = { rating: number; peakRating: number; tier: string | null; wins: number; games: number }
export type CombinedRecord = { teams: number; wins: number; games: number }

export const noStanding: Standing = { rating: 0, peakRating: 0, tier: null, wins: 0, games: 0 }

export function teammateOf(team: FixedTeam, ownId: number): { id: number; name: string } {
  const isFirst = team.brawlhallaIdOne === ownId
  const names = team.teamName.split('+').map((name) => fixEncoding(name).trim())

  return { id: isFirst ? team.brawlhallaIdTwo : team.brawlhallaIdOne, name: names[isFirst ? 1 : 0] ?? 'Unknown' }
}

export function combinedRecord(teams: FixedTeam[]): CombinedRecord {
  return {
    teams: teams.length,
    wins: teams.reduce((sum, team) => sum + team.wins, 0),
    games: teams.reduce((sum, team) => sum + team.games, 0),
  }
}

export function bestTeam(teams: FixedTeam[]): FixedTeam | null {
  return [...teams].sort((left, right) => right.rating - left.rating)[0] ?? null
}

export function soloQueueStanding(entries: SoloQueueEntry[]): SoloQueueEntry | null {
  return entries.find((entry) => entry.games > 0) ?? null
}

export function hasSoloQueue(entries: SoloQueueEntry[]): boolean {
  return soloQueueStanding(entries) !== null
}

export function rankedStanding(profile: PlayerRankedProfileContract | null): OneVsOne | null {
  return profile?.snapshot?.oneVsOne ?? null
}

function bestPeak(team: FixedTeam): number {
  return bestRating(team.rating, team.peakRating)
}

export const teamSorts = {
  elo: { label: 'Elo', score: (team: FixedTeam) => team.rating },
  peak: { label: 'Peak', score: bestPeak },
  games: { label: 'Games', score: (team: FixedTeam) => team.games },
  winRate: { label: 'Win rate', score: (team: FixedTeam) => winPercent(team.wins, team.games) },
}

export type TeamSortKey = keyof typeof teamSorts

export const teamSortOptions = Object.entries(teamSorts).map(([value, { label }]) => ({ value, label }))

export function sortTeams(teams: FixedTeam[], sort: TeamSortKey): FixedTeam[] {
  const { score } = teamSorts[sort]

  return [...teams].sort((left, right) => score(right) - score(left))
}
