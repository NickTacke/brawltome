import { describe, expect, it } from 'vitest';
import { createWeaponAggregator, parseDamage } from './weapon-aggregation';

describe('shared-utils/weapon-aggregation', () => {
  it('parseDamage returns 0 for null/undefined/non-numbers', () => {
    expect(parseDamage(undefined)).toBe(0);
    expect(parseDamage(null)).toBe(0);
    expect(parseDamage('')).toBe(0);
    expect(parseDamage('abc')).toBe(0);
  });

  it('createWeaponAggregator aggregates time/damage/KOs by weapon', () => {
    const agg = createWeaponAggregator();

    agg.add('Sword', 10, 100, 2);
    agg.add('Sword', 5, 50, 1);
    agg.add('  ', 999, 999, 999); // ignored
    agg.add(undefined, 999, 999, 999); // ignored

    const rows = Array.from(agg.values());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      weapon: 'Sword',
      timeHeld: 15,
      damage: 150,
      KOs: 3,
    });
  });
});
