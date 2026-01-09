export const parseDamage = (value: string | null | undefined): number => {
  const n = parseInt(value || '0', 10);
  return Number.isFinite(n) ? n : 0;
};

export type WeaponAgg = {
  weapon: string;
  timeHeld: number;
  damage: number;
  KOs: number;
};

export const createWeaponAggregator = () => {
  const weaponAgg = new Map<string, WeaponAgg>();
  return {
    add: (
      weapon: string | undefined,
      timeHeld: number,
      damage: number,
      kos: number
    ) => {
      const key = (weapon || '').trim();
      if (!key) return;
      const current = weaponAgg.get(key) || {
        weapon: key,
        timeHeld: 0,
        damage: 0,
        KOs: 0,
      };
      current.timeHeld += timeHeld || 0;
      current.damage += damage || 0;
      current.KOs += kos || 0;
      weaponAgg.set(key, current);
    },
    values: () => weaponAgg.values(),
  };
};

// Rich weapon aggregation types for frontend use
export interface RichWeaponRanked {
  games: number;
  wins: number;
  ratings: number[];
  peakRatings: number[];
  mostPlayed: { name: string; games: number; key: string };
  highestElo: { name: string; elo: number; key: string };
  highestPeak: { name: string; elo: number; key: string };
}

export interface RichWeaponAgg {
  weapon: string;
  label?: string;
  games: number;
  wins: number;
  xp: number;
  totalLevel: number;
  legendCount: number;
  timeHeld: number;
  KOs: number;
  damage: number;
  share?: number;
  usageRate?: number;
  ranked: RichWeaponRanked;
}

export interface LegendWeaponData {
  weaponOne: string | undefined;
  weaponTwo: string | undefined;
  timeHeldWeaponOne: number;
  timeHeldWeaponTwo: number;
  KOWeaponOne: number;
  KOWeaponTwo: number;
  damageWeaponOne: string | number;
  damageWeaponTwo: string | number;
  games: number;
  wins: number;
  xp: number;
  level: number;
  bioName?: string;
  legendNameKey: string;
  ranked?: {
    games: number;
    wins: number;
    rating: number;
    peakRating: number;
  };
}

const parseNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
};

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
  ranked: {
    games: 0,
    wins: 0,
    ratings: [],
    peakRatings: [],
    mostPlayed: { name: '', games: 0, key: '' },
    highestElo: { name: '', elo: 0, key: '' },
    highestPeak: { name: '', elo: 0, key: '' },
  },
});

export function aggregateRichWeaponStats(
  legends: LegendWeaponData[]
): RichWeaponAgg[] {
  const weaponStatsMap = new Map<string, RichWeaponAgg>();

  for (const l of legends) {
    const weapons = [
      {
        name: l.weaponOne,
        time: l.timeHeldWeaponOne,
        kos: l.KOWeaponOne,
        dmg: l.damageWeaponOne,
      },
      {
        name: l.weaponTwo,
        time: l.timeHeldWeaponTwo,
        kos: l.KOWeaponTwo,
        dmg: l.damageWeaponTwo,
      },
    ];

    for (const w of weapons) {
      if (!w.name) continue;
      const current =
        weaponStatsMap.get(w.name) || createEmptyRichWeaponAgg(w.name);

      current.games += parseNum(l.games);
      current.wins += parseNum(l.wins);
      current.xp += parseNum(l.xp);
      current.totalLevel += parseNum(l.level);
      current.legendCount += 1;
      current.timeHeld += parseNum(w.time);
      current.KOs += parseNum(w.kos);
      current.damage += parseNum(w.dmg);

      // Track most played legend for this weapon
      if (parseNum(l.games) > current.ranked.mostPlayed.games) {
        current.ranked.mostPlayed = {
          name: l.bioName || l.legendNameKey,
          games: parseNum(l.games),
          key: l.legendNameKey,
        };
      }

      if (l.ranked) {
        current.ranked.games += parseNum(l.ranked.games);
        current.ranked.wins += parseNum(l.ranked.wins);
        current.ranked.ratings.push(parseNum(l.ranked.rating));
        current.ranked.peakRatings.push(parseNum(l.ranked.peakRating));

        if (parseNum(l.ranked.rating) > current.ranked.highestElo.elo) {
          current.ranked.highestElo = {
            name: l.bioName || l.legendNameKey,
            elo: parseNum(l.ranked.rating),
            key: l.legendNameKey,
          };
        }
        if (parseNum(l.ranked.peakRating) > current.ranked.highestPeak.elo) {
          current.ranked.highestPeak = {
            name: l.bioName || l.legendNameKey,
            elo: parseNum(l.ranked.peakRating),
            key: l.legendNameKey,
          };
        }
      }

      weaponStatsMap.set(w.name, current);
    }
  }

  const values = Array.from(weaponStatsMap.values());
  const totalTimeHeld = values.reduce((sum, w) => sum + w.timeHeld, 0);
  const totalGames = values.reduce((sum, w) => sum + w.games, 0);

  return values
    .map((w) => ({
      ...w,
      share: totalTimeHeld > 0 ? w.timeHeld / totalTimeHeld : 0,
      usageRate: totalGames > 0 ? w.games / totalGames : 0,
    }))
    .filter((w) => w.timeHeld > 0 || w.damage > 0 || w.KOs > 0)
    .sort((a, b) => b.timeHeld - a.timeHeld);
}
