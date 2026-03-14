const parseNum = (v: unknown): number => {
  if (typeof v === 'bigint') return Number(v)
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? '0'), 10)
  return Number.isFinite(n) ? n : 0
}

export interface RichWeaponRanked {
  games: number
  wins: number
  ratings: number[]
  peakRatings: number[]
  mostPlayed: { name: string; games: number; key: string }
  highestElo: { name: string; elo: number; key: string }
  highestPeak: { name: string; elo: number; key: string }
}

export interface RichWeaponAgg {
  weapon: string
  games: number
  wins: number
  xp: number
  totalLevel: number
  legendCount: number
  timeHeld: number
  KOs: number
  damage: number
  share: number
  usageRate: number
  ranked: RichWeaponRanked
}

interface LegendInput {
  legendId: number
  legendNameKey: string
  weaponOne?: string | null
  weaponTwo?: string | null
  bioName?: string | null
  timeHeldWeaponOne: number
  timeHeldWeaponTwo: number
  koWeaponOne: number
  koWeaponTwo: number
  damageWeaponOne: string | number | bigint
  damageWeaponTwo: string | number | bigint
  games: number
  wins: number
  xp: number
  level: number
}

interface RankedLegendInput {
  legendId: number
  legendNameKey: string
  rating: number
  peakRating: number
  tier: string
  wins: number
  games: number
}

const createEmptyRichWeaponAgg = (weaponName: string): RichWeaponAgg => ({
  weapon: weaponName,
  games: 0,
  wins: 0,
  xp: 0,
  totalLevel: 0,
  legendCount: 0,
  timeHeld: 0,
  KOs: 0,
  damage: 0,
  share: 0,
  usageRate: 0,
  ranked: {
    games: 0,
    wins: 0,
    ratings: [],
    peakRatings: [],
    mostPlayed: { name: '', games: 0, key: '' },
    highestElo: { name: '', elo: 0, key: '' },
    highestPeak: { name: '', elo: 0, key: '' },
  },
})

export function aggregateRichWeaponStats(legends: LegendInput[], rankedLegends: RankedLegendInput[]): RichWeaponAgg[] {
  const rankedMap = new Map(rankedLegends.map((r) => [r.legendId, r]))
  const weaponStatsMap = new Map<string, RichWeaponAgg>()

  for (const l of legends) {
    const ranked = rankedMap.get(l.legendId)
    const weapons = [
      {
        name: l.weaponOne,
        time: l.timeHeldWeaponOne,
        kos: l.koWeaponOne,
        dmg: l.damageWeaponOne,
      },
      {
        name: l.weaponTwo,
        time: l.timeHeldWeaponTwo,
        kos: l.koWeaponTwo,
        dmg: l.damageWeaponTwo,
      },
    ]

    for (const w of weapons) {
      if (!w.name) continue
      const current = weaponStatsMap.get(w.name) || createEmptyRichWeaponAgg(w.name)

      current.games += parseNum(l.games)
      current.wins += parseNum(l.wins)
      current.xp += parseNum(l.xp)
      current.totalLevel += parseNum(l.level)
      current.legendCount += 1
      current.timeHeld += parseNum(w.time)
      current.KOs += parseNum(w.kos)
      current.damage += parseNum(w.dmg)

      if (parseNum(l.games) > current.ranked.mostPlayed.games) {
        current.ranked.mostPlayed = {
          name: l.bioName || l.legendNameKey,
          games: parseNum(l.games),
          key: l.legendNameKey,
        }
      }

      if (ranked) {
        current.ranked.games += parseNum(ranked.games)
        current.ranked.wins += parseNum(ranked.wins)
        current.ranked.ratings.push(parseNum(ranked.rating))
        current.ranked.peakRatings.push(parseNum(ranked.peakRating))

        if (parseNum(ranked.rating) > current.ranked.highestElo.elo) {
          current.ranked.highestElo = {
            name: l.bioName || l.legendNameKey,
            elo: parseNum(ranked.rating),
            key: l.legendNameKey,
          }
        }
        if (parseNum(ranked.peakRating) > current.ranked.highestPeak.elo) {
          current.ranked.highestPeak = {
            name: l.bioName || l.legendNameKey,
            elo: parseNum(ranked.peakRating),
            key: l.legendNameKey,
          }
        }
      }

      weaponStatsMap.set(w.name, current)
    }
  }

  const values = Array.from(weaponStatsMap.values())
  const totalTimeHeld = values.reduce((sum, w) => sum + w.timeHeld, 0)
  const totalGames = values.reduce((sum, w) => sum + w.games, 0)

  return values
    .map((w) => ({
      ...w,
      share: totalTimeHeld > 0 ? w.timeHeld / totalTimeHeld : 0,
      usageRate: totalGames > 0 ? w.games / totalGames : 0,
    }))
    .filter((w) => w.timeHeld > 0 || w.damage > 0 || w.KOs > 0)
    .sort((a, b) => b.timeHeld - a.timeHeld)
}
