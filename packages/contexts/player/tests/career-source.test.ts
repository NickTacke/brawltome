import { describe, expect, test } from 'bun:test'
import { decodeV0CareerSnapshot } from '../career/source'

const completeSnapshot = {
  brawlhalla_id: 91913839,
  name: 'Measured Zero',
  xp: 1234,
  level: 12,
  xp_percentage: 0,
  games: 10,
  wins: 4,
  damagebomb: '9007199254740993',
  damagemine: '0',
  damagespikeball: '2',
  damagesidekick: '3',
  hitsnowball: 0,
  kobomb: 1,
  komine: 0,
  kospikeball: 2,
  kosidekick: 3,
  kosnowball: 0,
  legends: [
    {
      legend_id: 3,
      legend_name_key: 'bodvar',
      xp: 100,
      level: 2,
      xp_percentage: 0,
      games: 10,
      wins: 4,
      matchtime: 600,
      kos: 20,
      falls: 15,
      suicides: 0,
      teamkos: 1,
      damagedealt: '9007199254740993',
      damagetaken: '800',
      damageunarmed: '100',
      damagethrownitem: '10',
      damagegadgets: '20',
      kounarmed: 2,
      kothrownitem: 1,
      kogadgets: 0,
      damageweaponone: '9007199254740993',
      damageweapontwo: '7',
      koweaponone: 12,
      koweapontwo: 5,
      timeheldweaponone: 500,
      timeheldweapontwo: 100,
    },
  ],
}

const resolveLegend = (legendId: number, legendNameKey: string) =>
  legendId === 3 && legendNameKey === 'bodvar'
    ? { legendId: 3, legendNameKey: 'bodvar', weaponOne: 'Hammer', weaponTwo: 'Sword' }
    : null

describe('V0 career snapshot source contract', () => {
  test('maps one complete observation and preserves exact decimal damage', () => {
    expect(decodeV0CareerSnapshot(completeSnapshot, 91913839, resolveLegend)).toEqual({
      brawlhallaId: 91913839,
      name: 'Measured Zero',
      account: { xp: 1234, level: 12, xpPercentage: 0 },
      combat: {
        games: 10,
        wins: 4,
        matchTime: 600,
        damageBomb: '9007199254740993',
        damageMine: '0',
        damageSpikeball: '2',
        damageSidekick: '3',
        snowballHits: 0,
        bombKos: 1,
        mineKos: 0,
        spikeballKos: 2,
        sidekickKos: 3,
        snowballKos: 0,
      },
      legends: [
        {
          legendId: 3,
          legendNameKey: 'bodvar',
          xp: 100,
          level: 2,
          xpPercentage: 0,
          games: 10,
          wins: 4,
          matchTime: 600,
          kos: 20,
          falls: 15,
          suicides: 0,
          teamKos: 1,
          damageDealt: '9007199254740993',
          damageTaken: '800',
          unarmed: { damage: '100', kos: 2 },
          thrownItem: { damage: '10', kos: 1 },
          gadgets: { damage: '20', kos: 0 },
          weaponOne: { damage: '9007199254740993', kos: 12, heldTime: 500 },
          weaponTwo: { damage: '7', kos: 5, heldTime: 100 },
        },
      ],
      weapons: [
        { weapon: 'Hammer', heldTime: 500, damage: '9007199254740993', kos: 12 },
        { weapon: 'Sword', heldTime: 100, damage: '7', kos: 5 },
      ],
    })
  })

  test('accepts an authoritative empty legend collection', () => {
    const decoded = decodeV0CareerSnapshot({ ...completeSnapshot, legends: [] }, 91913839, resolveLegend)

    expect(decoded.legends).toEqual([])
    expect(decoded.weapons).toEqual([])
    expect(decoded.combat.matchTime).toBe(0)
  })

  test.each([
    { ...completeSnapshot, xp_percentage: 1.01 },
    { ...completeSnapshot, wins: completeSnapshot.games + 1 },
    {
      ...completeSnapshot,
      legends: [{ ...completeSnapshot.legends[0], wins: completeSnapshot.legends[0].games + 1 }],
    },
    { ...completeSnapshot, brawlhalla_id: 42 },
    { ...completeSnapshot, games: undefined },
    { ...completeSnapshot, legends: undefined },
    { ...completeSnapshot, damagebomb: '01' },
    { ...completeSnapshot, legends: [{ ...completeSnapshot.legends[0], legend_id: 0 }] },
    { ...completeSnapshot, legends: [completeSnapshot.legends[0], completeSnapshot.legends[0]] },
    { ...completeSnapshot, legends: [{ ...completeSnapshot.legends[0], wins: -1 }] },
  ])('rejects partial, contradictory, or malformed observations %#', (payload: unknown) => {
    expect(() => decodeV0CareerSnapshot(payload, 91913839, resolveLegend)).toThrow()
  })

  test('omits an unresolved new legend without discarding the valid profile', () => {
    const decoded = decodeV0CareerSnapshot(completeSnapshot, 91913839, () => null)
    expect(decoded.name).toBe('Measured Zero')
    expect(decoded.combat.matchTime).toBe(600)
    expect(decoded.legends).toEqual([])
    expect(decoded.weapons).toEqual([])
  })
})
