export type LegendSortKey = 'xp' | 'winrate' | 'games' | 'playtime' | 'level' | 'elo' | 'peakElo'

export const LEGEND_SORT_OPTIONS: { value: LegendSortKey; label: string }[] = [
  { value: 'xp', label: 'XP' },
  { value: 'winrate', label: 'Win Rate' },
  { value: 'games', label: 'Games' },
  { value: 'playtime', label: 'Playtime' },
  { value: 'level', label: 'Level' },
  { value: 'elo', label: 'Elo' },
  { value: 'peakElo', label: 'Peak Elo' },
]

export interface RankedLegend {
  legendId: number
  games: number
  wins: number
  matchTime: number
  xp: number
  level: number
  elo: number
  peakElo: number
}

export interface WeaponInput {
  time: number
  dmg: number
  kos: number
}

export interface WeaponStats {
  dps: number
  timeToKill: number | null
}

export function computeWeaponStats(input: WeaponInput): WeaponStats {
  const dps = input.time > 0 ? input.dmg / input.time : 0
  const timeToKill = input.kos > 0 && input.time > 0 ? input.time / input.kos : null
  return { dps, timeToKill }
}

export interface LegendStats {
  winrate: number
  playtimeHours: number
}

export function computeLegendStats(legend: RankedLegend): LegendStats {
  return {
    winrate: legend.games > 0 ? legend.wins / legend.games : 0,
    playtimeHours: legend.matchTime / 3600,
  }
}

export function sortLegends(legends: RankedLegend[], key: LegendSortKey): RankedLegend[] {
  const sorted = [...legends]
  switch (key) {
    case 'xp':
      sorted.sort((a, b) => b.xp - a.xp)
      break
    case 'games':
      sorted.sort((a, b) => b.games - a.games)
      break
    case 'winrate':
      sorted.sort((a, b) => {
        const wa = a.games > 0 ? a.wins / a.games : -1
        const wb = b.games > 0 ? b.wins / b.games : -1
        return wb - wa
      })
      break
    case 'playtime':
      sorted.sort((a, b) => b.matchTime - a.matchTime)
      break
    case 'level':
      sorted.sort((a, b) => b.level - a.level)
      break
    case 'elo':
      sorted.sort((a, b) => b.elo - a.elo)
      break
    case 'peakElo':
      sorted.sort((a, b) => b.peakElo - a.peakElo)
      break
  }
  return sorted
}
