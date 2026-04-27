import type { RichWeaponAgg } from '@/lib/weapon-aggregation'

export type WeaponSortKey = 'timePlayed' | 'games' | 'winrate' | 'damage' | 'kos'

export function sortWeapons(weapons: RichWeaponAgg[], key: WeaponSortKey): RichWeaponAgg[] {
  const sorted = [...weapons]
  switch (key) {
    case 'games':
      sorted.sort((a, b) => b.games - a.games)
      break
    case 'winrate':
      sorted.sort((a, b) => {
        const wa = a.games > 0 ? a.wins / a.games : 0
        const wb = b.games > 0 ? b.wins / b.games : 0
        return wb - wa
      })
      break
    case 'damage':
      sorted.sort((a, b) => b.damage - a.damage)
      break
    case 'kos':
      sorted.sort((a, b) => b.KOs - a.KOs)
      break
    default:
      sorted.sort((a, b) => b.timeHeld - a.timeHeld)
  }
  return sorted
}

export interface WeaponDerived {
  winrate: number
  dps: number
  avgKos: number
  avgElo: number
  avgPeak: number
  rankedWinrate: number
  dmgPerKO: number
  avgDmgPerGame: number
  avgLegendLevel: number
  avgLegendXp: number
}

export function computeWeaponDerived(w: RichWeaponAgg): WeaponDerived {
  const winrate = w.games > 0 ? (w.wins / w.games) * 100 : 0
  const dps = w.timeHeld > 0 ? w.damage / w.timeHeld : 0
  const avgKos = w.games > 0 ? w.KOs / w.games : 0
  const avgElo = w.ranked.ratings.length > 0 ? w.ranked.ratings.reduce((a, b) => a + b, 0) / w.ranked.ratings.length : 0
  const avgPeak =
    w.ranked.peakRatings.length > 0 ? w.ranked.peakRatings.reduce((a, b) => a + b, 0) / w.ranked.peakRatings.length : 0
  const rankedWinrate = w.ranked.games > 0 ? (w.ranked.wins / w.ranked.games) * 100 : 0
  const dmgPerKO = w.KOs > 0 ? Math.round(w.damage / w.KOs) : 0
  const avgDmgPerGame = w.games > 0 ? Math.round(w.damage / w.games) : 0
  const avgLegendLevel = w.legendCount > 0 ? Math.round(w.totalLevel / w.legendCount) : 0
  const avgLegendXp = w.legendCount > 0 ? Math.round(w.xp / w.legendCount) : 0

  return {
    winrate,
    dps,
    avgKos,
    avgElo,
    avgPeak,
    rankedWinrate,
    dmgPerKO,
    avgDmgPerGame,
    avgLegendLevel,
    avgLegendXp,
  }
}
