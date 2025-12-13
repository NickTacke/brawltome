export const parseDamage = (value: string | null | undefined): number => {
  const n = parseInt(value || '0', 10);
  return Number.isFinite(n) ? n : 0;
};

export type WeaponAgg = { weapon: string; timeHeld: number; damage: number; KOs: number };

export const createWeaponAggregator = () => {
  const weaponAgg = new Map<string, WeaponAgg>();
  return {
    add: (weapon: string | undefined, timeHeld: number, damage: number, kos: number) => {
      const key = (weapon || '').trim();
      if (!key) return;
      const current = weaponAgg.get(key) || { weapon: key, timeHeld: 0, damage: 0, KOs: 0 };
      current.timeHeld += timeHeld || 0;
      current.damage += damage || 0;
      current.KOs += kos || 0;
      weaponAgg.set(key, current);
    },
    values: () => weaponAgg.values(),
  };
};


