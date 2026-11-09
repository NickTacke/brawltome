import { formatGrouped, formatHours, formatShort, winPercent } from './player-format'
import type { CareerLegend, RankedLegend, WeaponStats } from './weapon-stats'

const minimumGamesForWinRate = 10

type LegendSort = {
  label: string
  score: (legend: CareerLegend, ranked: RankedLegend | undefined) => number
  value: (legend: CareerLegend, ranked: RankedLegend | undefined) => string
}

type WeaponSort = { label: string; score: (weapon: WeaponStats) => number; value: (weapon: WeaponStats) => string }

function hasEnoughGames(legend: CareerLegend): boolean {
  return legend.games >= minimumGamesForWinRate
}

function legendWinRateScore(legend: CareerLegend): number {
  return hasEnoughGames(legend) ? winPercent(legend.wins, legend.games) : -1
}

function legendWinRateText(legend: CareerLegend): string {
  return hasEnoughGames(legend) ? `${winPercent(legend.wins, legend.games).toFixed(0)}%` : '–'
}

export const legendSorts = {
  // sorted by xp so legends on the same level still have a real order
  level: { label: 'Level', score: (legend) => legend.xp, value: (legend) => `Lvl ${legend.level}` },
  elo: {
    label: 'Elo',
    score: (_, ranked) => ranked?.rating ?? 0,
    value: (_, ranked) => (ranked ? formatGrouped(ranked.rating) : '–'),
  },
  winRate: { label: 'Win rate', score: legendWinRateScore, value: legendWinRateText },
  games: { label: 'Games', score: (legend) => legend.games, value: (legend) => formatShort(legend.games) },
  playtime: {
    label: 'Playtime',
    score: (legend) => legend.matchTime,
    value: (legend) => formatHours(legend.matchTime),
  },
} satisfies Record<string, LegendSort>

export type LegendSortKey = keyof typeof legendSorts

export const defaultLegendSort: LegendSortKey = 'elo'

export const legendSortOptions = Object.entries(legendSorts).map(([value, { label }]) => ({ value, label }))

export function sortLegends(
  legends: CareerLegend[],
  rankedById: ReadonlyMap<number, RankedLegend>,
  sort: LegendSortKey,
): CareerLegend[] {
  const { score } = legendSorts[sort] as LegendSort
  const scoreOf = (legend: CareerLegend) => score(legend, rankedById.get(legend.legendId))

  return [...legends].sort((left, right) => scoreOf(right) - scoreOf(left))
}

function weaponWinRateScore(weapon: WeaponStats): number {
  return weapon.games > 0 ? winPercent(weapon.wins, weapon.games) : -1
}

function weaponWinRateText(weapon: WeaponStats): string {
  return weapon.games > 0 ? `${winPercent(weapon.wins, weapon.games).toFixed(0)}%` : '–'
}

export const weaponSorts = {
  playtime: { label: 'Playtime', score: (weapon) => weapon.timeHeld, value: (weapon) => formatHours(weapon.timeHeld) },
  kos: { label: 'KOs', score: (weapon) => weapon.KOs, value: (weapon) => formatShort(weapon.KOs) },
  damage: { label: 'Damage', score: (weapon) => weapon.damage, value: (weapon) => formatShort(weapon.damage) },
  winRate: { label: 'Win rate', score: weaponWinRateScore, value: weaponWinRateText },
} satisfies Record<string, WeaponSort>

export type WeaponSortKey = keyof typeof weaponSorts

export const weaponSortOptions = Object.entries(weaponSorts).map(([value, { label }]) => ({ value, label }))

export function sortWeapons(weapons: WeaponStats[], sort: WeaponSortKey): WeaponStats[] {
  const { score } = weaponSorts[sort] as WeaponSort

  return [...weapons].sort((left, right) => score(right) - score(left))
}
