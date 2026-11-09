import type { PlayerCareerProfileContract, PlayerRankedProfileContract } from '@brawltome/contracts'
import { legendWeapons } from '@brawltome/contracts/legend-weapons'
import { bestRating } from './player-format'

export type CareerLegend = NonNullable<PlayerCareerProfileContract['snapshot']>['legends'][number]
export type RankedLegend = NonNullable<PlayerRankedProfileContract['snapshot']>['rankedLegends'][number]

type RankedWeaponStats = {
  games: number
  ratings: number[]
  peakRatings: number[]
  mostPlayed: { key: string; games: number }
  highestElo: { key: string; elo: number }
  highestPeak: { key: string; elo: number }
}

export type WeaponStats = {
  weapon: string
  games: number
  wins: number
  legendCount: number
  timeHeld: number
  KOs: number
  damage: number
  share: number
  ranked: RankedWeaponStats
}

type WeaponSlot = CareerLegend['weaponOne']

// the icons in public/images/weapons, a new weapon has nothing to show until it gets one
export const knownWeapons: ReadonlySet<string> = new Set([
  'Axe',
  'Blasters',
  'Boots',
  'Bow',
  'Cannon',
  'Chakrams',
  'Gauntlets',
  'Greatsword',
  'Hammer',
  'Katars',
  'Lance',
  'Orb',
  'Scythe',
  'Spear',
  'Sword',
])

export function emptyWeaponStats(weapon: string): WeaponStats {
  return {
    weapon,
    games: 0,
    wins: 0,
    legendCount: 0,
    timeHeld: 0,
    KOs: 0,
    damage: 0,
    share: 0,
    ranked: {
      games: 0,
      ratings: [],
      peakRatings: [],
      mostPlayed: { key: '', games: 0 },
      highestElo: { key: '', elo: 0 },
      highestPeak: { key: '', elo: 0 },
    },
  }
}

function addRanked(totals: RankedWeaponStats, ranked: RankedLegend, legendKey: string) {
  const peak = bestRating(ranked.rating, ranked.peakRating)

  totals.games += ranked.games

  // unplayed legends sit at the default rating with a peak of 0
  if (ranked.games > 0) {
    totals.ratings.push(ranked.rating)
    totals.peakRatings.push(peak)
  }

  if (ranked.games > totals.mostPlayed.games) totals.mostPlayed = { key: legendKey, games: ranked.games }

  if (ranked.rating > totals.highestElo.elo) totals.highestElo = { key: legendKey, elo: ranked.rating }

  if (peak > totals.highestPeak.elo) totals.highestPeak = { key: legendKey, elo: peak }
}

function addSlot(totals: WeaponStats, legend: CareerLegend, slot: WeaponSlot, ranked: RankedLegend | undefined) {
  totals.games += legend.games
  totals.wins += legend.wins
  totals.legendCount += 1
  totals.timeHeld += slot.heldTime
  totals.KOs += slot.kos
  totals.damage += Number(slot.damage)

  if (ranked) addRanked(totals.ranked, ranked, legend.legendNameKey)
}

function slotsOf(legend: CareerLegend): Array<{ weapon: string; slot: WeaponSlot }> {
  const weapons = legendWeapons.get(legend.legendId)

  if (!weapons) return []

  const slots = [
    { weapon: weapons.weaponOne, slot: legend.weaponOne },
    { weapon: weapons.weaponTwo, slot: legend.weaponTwo },
  ]

  return slots.filter(({ weapon }) => knownWeapons.has(weapon))
}

export function wasUsed(stats: WeaponStats): boolean {
  return stats.timeHeld > 0 || stats.damage > 0 || stats.KOs > 0
}

export function withShares(weapons: WeaponStats[]): WeaponStats[] {
  const totalTime = weapons.reduce((sum, weapon) => sum + weapon.timeHeld, 0)

  return weapons.map((weapon) => ({ ...weapon, share: totalTime > 0 ? weapon.timeHeld / totalTime : 0 }))
}

export function weaponStats(legends: CareerLegend[], rankedLegends: RankedLegend[]): WeaponStats[] {
  const rankedById = new Map(rankedLegends.map((ranked) => [ranked.legendId, ranked]))
  const totals = new Map<string, WeaponStats>()

  for (const legend of legends) {
    for (const { weapon, slot } of slotsOf(legend)) {
      const stats = totals.get(weapon) ?? emptyWeaponStats(weapon)

      addSlot(stats, legend, slot, rankedById.get(legend.legendId))
      totals.set(weapon, stats)
    }
  }

  const used = [...totals.values()].filter(wasUsed).sort((left, right) => right.timeHeld - left.timeHeld)

  return withShares(used)
}
