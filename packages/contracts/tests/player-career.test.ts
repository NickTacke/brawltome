import { describe, expect, test } from 'bun:test'
import {
  type PlayerCareerProfileContract,
  parsePlayerCareerProfileOutput,
  playerCareerProfileSchema,
} from '../src/player-career'

const legend = {
  legendId: 3,
  legendNameKey: 'bodvar',
  xp: 0,
  level: 0,
  xpPercentage: 0,
  games: 0,
  wins: 0,
  matchTime: 0,
  kos: 0,
  falls: 0,
  suicides: 0,
  teamKos: 0,
  damageDealt: '9007199254740993',
  damageTaken: '0',
  unarmed: { damage: '0', kos: 0 },
  thrownItem: { damage: '0', kos: 0 },
  gadgets: { damage: '0', kos: 0 },
  weaponOne: { damage: '9007199254740993', kos: 0, heldTime: 0 },
  weaponTwo: { damage: '0', kos: 0, heldTime: 0 },
}

const profile: PlayerCareerProfileContract = {
  brawlhallaId: 91913839,
  checkedAt: '2026-08-09T22:00:00Z',
  lastSuccessAt: '2026-08-09T22:00:00Z',
  freshness: 'fresh',
  freshForSeconds: 43_200,
  snapshot: {
    account: { xp: 0, level: 0, xpPercentage: 0 },
    combat: {
      games: 0,
      wins: 0,
      matchTime: 0,
      damageBomb: '9007199254740993',
      damageMine: '0',
      damageSpikeball: '0',
      damageSidekick: '0',
      snowballHits: 0,
      bombKos: 0,
      mineKos: 0,
      spikeballKos: 0,
      sidekickKos: 0,
      snowballKos: 0,
    },
    legends: [legend],
    weapons: [{ weapon: 'Hammer', heldTime: 0, damage: '9007199254740993', kos: 0 }],
  },
}

describe('Player career profile contract', () => {
  test('preserves measured zero, exact damage, complete collections, and twelve-hour freshness', () => {
    expect(parsePlayerCareerProfileOutput(profile)).toEqual(profile)
    expect(
      parsePlayerCareerProfileOutput({
        ...profile,
        lastSuccessAt: null,
        freshness: 'unavailable',
        snapshot: null,
      }),
    ).toMatchObject({ lastSuccessAt: null, snapshot: null, freshForSeconds: 43_200 })
  })

  test.each([
    { ...profile, freshForSeconds: 3600 },
    { ...profile, snapshot: { ...profile.snapshot, legends: undefined } },
    {
      ...profile,
      snapshot: {
        ...profile.snapshot,
        weapons: [{ weapon: 'Hammer', heldTime: 0, damage: '0', kos: 0, games: 2 }],
      },
    },
    { ...profile, lastSuccessAt: null, freshness: 'fresh', snapshot: profile.snapshot },
    { ...profile, lastSuccessAt: profile.lastSuccessAt, freshness: 'unavailable', snapshot: null },
    {
      ...profile,
      snapshot: {
        ...profile.snapshot,
        account: { ...(profile.snapshot?.account ?? {}), xpPercentage: 1.01 },
      },
    },
    {
      ...profile,
      snapshot: {
        ...profile.snapshot,
        combat: { ...(profile.snapshot?.combat ?? {}), wins: 1, games: 0 },
      },
    },
    {
      ...profile,
      snapshot: { ...profile.snapshot, legends: [{ ...legend, wins: 1, games: 0 }] },
    },
    {
      ...profile,
      snapshot: {
        ...profile.snapshot,
        combat: { ...(profile.snapshot?.combat ?? {}), damageBomb: 1 },
      },
    },
    {
      ...profile,
      snapshot: { ...profile.snapshot, legends: [{ ...legend, damageDealt: '01' }] },
    },
  ])('rejects partial, inexact, or unsupported producer output %#', (value: unknown) => {
    expect(() => playerCareerProfileSchema.parse(value)).toThrow()
  })
})
