import { describe, expect, test } from 'bun:test'
import type { LegendReference } from '@brawltome/game-data'
import type { LifetimeEvidence } from '../source'
import {
  CAREER_WEAPON_MIN_AGGREGATE_HELD_SECONDS,
  CAREER_WEAPON_MIN_CONTRIBUTORS,
  CAREER_WEAPON_MIN_PLAYER_HELD_SECONDS,
  aggregateCareerWeaponUsage,
} from '../weapon-usage'

const legends: LegendReference[] = [
  {
    legendId: 3,
    legendNameKey: 'bodvar',
    bioName: 'Bödvar',
    weaponOne: 'Hammer',
    weaponTwo: 'Sword',
  },
]

const combat: LifetimeEvidence['combat'] = {
  damage_bomb: 0,
  damage_mine: 0,
  damage_spikeball: 0,
  damage_sidekick: 0,
  hit_snowball: 0,
  ko_bomb: 0,
  ko_mine: 0,
  ko_sidekick: 0,
  ko_snowball: 0,
  ko_spikeball: 0,
}

function observation(
  brawlhallaId: number,
  {
    hammerHeld = 3_600,
    swordHeld = 3_600,
    hammerDamage = 60,
    swordDamage = 0,
    hammerKos = 1,
    swordKos = 0,
    legendDamage = 999_999,
    legendKos = 999,
  }: {
    hammerHeld?: number
    swordHeld?: number
    hammerDamage?: number
    swordDamage?: number
    hammerKos?: number
    swordKos?: number
    legendDamage?: number
    legendKos?: number
  } = {},
): LifetimeEvidence {
  return {
    brawlhallaId,
    games: 100,
    wins: 50,
    combat,
    legends: [
      {
        legendId: 3,
        games: 100,
        wins: 50,
        damageDealt: legendDamage,
        damageTaken: 800_000,
        kos: legendKos,
        falls: 500,
        suicides: 2,
        teamKos: 1,
        matchTime: 20_000,
        damageUnarmed: 50_000,
        damageThrownItem: 10_000,
        damageWeaponOne: hammerDamage,
        damageWeaponTwo: swordDamage,
        damageGadgets: 5_000,
        koUnarmed: 100,
        koWeaponOne: hammerKos,
        koWeaponTwo: swordKos,
        koGadgets: 50,
        timeHeldWeaponOne: hammerHeld,
        timeHeldWeaponTwo: swordHeld,
      },
    ],
  }
}

function hammerEligibility(heldSeconds: readonly number[]) {
  const result = aggregateCareerWeaponUsage({
    selectedPlayers: heldSeconds.length,
    observations: heldSeconds.map((held, index) =>
      observation(index + 1, { hammerHeld: held, swordHeld: 0, hammerDamage: held, hammerKos: 0 }),
    ),
    legendReferences: legends,
  })
  const hammer = result.rows.find(({ weapon }) => weapon === 'Hammer')
  if (!hammer) throw new Error('Hammer row missing')
  return hammer
}

describe('Career Weapon Usage formulas', () => {
  test('reproduces exact prevalence, held-time share, per-player medians, contributors, coverage, and measured zero', () => {
    const observations = Array.from({ length: 30 }, (_, index) =>
      observation(index + 1, {
        hammerDamage: index < 15 ? 60 : 120,
        hammerKos: index < 15 ? 1 : 3,
      }),
    )

    const result = aggregateCareerWeaponUsage({ selectedPlayers: 30, observations, legendReferences: legends })

    expect(result).toEqual({
      selectedPlayers: 30,
      successfulObservations: 30,
      coverage: { numerator: '1', denominator: '1' },
      totalHeldSeconds: '216000',
      rows: [
        {
          weapon: 'Hammer',
          observedPlayers: 30,
          prevalence: { numerator: '1', denominator: '1' },
          heldTimeSeconds: '108000',
          heldTimeShare: { numerator: '1', denominator: '2' },
          contributorCount: 30,
          qualifyingHeldSeconds: '108000',
          medianDamagePerMinute: { numerator: '3', denominator: '2' },
          medianKosPerHour: { numerator: '2', denominator: '1' },
          comparison: { eligible: true, reasons: [] },
        },
        {
          weapon: 'Sword',
          observedPlayers: 30,
          prevalence: { numerator: '1', denominator: '1' },
          heldTimeSeconds: '108000',
          heldTimeShare: { numerator: '1', denominator: '2' },
          contributorCount: 30,
          qualifyingHeldSeconds: '108000',
          medianDamagePerMinute: { numerator: '0', denominator: '1' },
          medianKosPerHour: { numerator: '0', denominator: '1' },
          comparison: { eligible: true, reasons: [] },
        },
      ],
    })
  })

  test('uses only slot-specific weapon facts and never double-attributes legend totals', () => {
    const result = aggregateCareerWeaponUsage({
      selectedPlayers: 1,
      observations: [
        observation(1, {
          hammerHeld: 1_800,
          swordHeld: 0,
          hammerDamage: 300,
          swordDamage: 0,
          hammerKos: 2,
          swordKos: 0,
          legendDamage: 9_000_000,
          legendKos: 9_000,
        }),
      ],
      legendReferences: legends,
    })

    expect(result.totalHeldSeconds).toBe('1800')
    expect(result.rows.find(({ weapon }) => weapon === 'Hammer')).toMatchObject({
      observedPlayers: 1,
      heldTimeSeconds: '1800',
      contributorCount: 1,
    })
    expect(result.rows.find(({ weapon }) => weapon === 'Sword')).toMatchObject({
      observedPlayers: 0,
      heldTimeSeconds: '0',
      contributorCount: 0,
    })
  })

  test('enforces the exact per-player, contributor, and aggregate held-time gates', () => {
    expect(CAREER_WEAPON_MIN_PLAYER_HELD_SECONDS).toBe(1_800)
    expect(CAREER_WEAPON_MIN_CONTRIBUTORS).toBe(30)
    expect(CAREER_WEAPON_MIN_AGGREGATE_HELD_SECONDS).toBe(108_000)

    expect(hammerEligibility([1_799, ...Array(29).fill(3_600)])).toMatchObject({
      contributorCount: 29,
      comparison: {
        eligible: false,
        reasons: ['contributors-below-30', 'aggregate-held-time-below-30-hours'],
      },
      medianDamagePerMinute: null,
      medianKosPerHour: null,
    })
    expect(hammerEligibility(Array(29).fill(4_000))).toMatchObject({
      contributorCount: 29,
      qualifyingHeldSeconds: '116000',
      comparison: { eligible: false, reasons: ['contributors-below-30'] },
    })
    expect(hammerEligibility([...Array(29).fill(3_600), 3_599])).toMatchObject({
      contributorCount: 30,
      qualifyingHeldSeconds: '107999',
      comparison: { eligible: false, reasons: ['aggregate-held-time-below-30-hours'] },
    })
    expect(hammerEligibility(Array(30).fill(3_600))).toMatchObject({
      contributorCount: 30,
      qualifyingHeldSeconds: '108000',
      comparison: { eligible: true, reasons: [] },
      medianDamagePerMinute: { numerator: '60', denominator: '1' },
    })
    expect(hammerEligibility([...Array(30).fill(1_800), ...Array(31).fill(1_799)])).toMatchObject({
      contributorCount: 30,
      heldTimeSeconds: '109769',
      qualifyingHeldSeconds: '54000',
      comparison: { eligible: true, reasons: [] },
    })
  })

  test('rejects duplicate players and unresolved legend references instead of biasing denominators', () => {
    expect(() =>
      aggregateCareerWeaponUsage({
        selectedPlayers: 2,
        observations: [observation(1), observation(1)],
        legendReferences: legends,
      }),
    ).toThrow('duplicate player 1')

    const unresolved = observation(2)
    unresolved.legends[0].legendId = 999_999
    expect(() =>
      aggregateCareerWeaponUsage({ selectedPlayers: 1, observations: [unresolved], legendReferences: legends }),
    ).toThrow('unresolved legend 999999')

    const pseudoLegend = observation(3)
    pseudoLegend.legends[0].legendId = 1
    expect(() =>
      aggregateCareerWeaponUsage({
        selectedPlayers: 1,
        observations: [pseudoLegend],
        legendReferences: [
          ...legends,
          { legendId: 1, legendNameKey: 'default', bioName: '', weaponOne: '', weaponTwo: '' },
        ],
      }),
    ).toThrow('unresolved legend 1')
  })
})
