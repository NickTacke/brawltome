import { describe, expect, test } from 'bun:test'
import {
  decodeLifetimeEvidence,
  decodeRankedEvidence,
  validateLifetimeEvidence,
  validateRankedEvidence,
} from '../source'

const playerId = 91913839
const ranked = {
  brawlhalla_id: playerId,
  name: 'Observed',
  games: 20,
  wins: 12,
  rating: 2100,
  peak_rating: 2200,
  tier: 'Diamond',
  region: 'EU',
  region_ranks: [],
  legends: [{ legend_id: 3, games: 10, wins: 6, rating: 2050, peak_rating: 2150, tier: 'Diamond' }],
}

const lifetimeLegend = {
  legend_id: 3,
  games: 50,
  wins: 30,
  damage_dealt: 1000,
  damage_taken: 900,
  kos: 40,
  falls: 35,
  suicides: 1,
  team_kos: 0,
  match_time: 3000,
  damage_unarmed: 10,
  damage_thrown_item: 5,
  damage_weapon_one: 400,
  damage_weapon_two: 300,
  damage_gadgets: 20,
  ko_unarmed: 1,
  ko_thrown_item: 0,
  ko_weapon_one: 15,
  ko_weapon_two: 12,
  ko_gadgets: 1,
  time_held_weapon_one: 1200,
  time_held_weapon_two: 1500,
}
const lifetime = {
  brawlhalla_id: playerId,
  name: 'Observed',
  games: 100,
  wins: 60,
  damage_bomb: 10,
  damage_mine: 0,
  damage_spikeball: 0,
  damage_sidekick: 0,
  hit_snowball: 0,
  ko_bomb: 1,
  ko_mine: 0,
  ko_sidekick: 0,
  ko_snowball: 0,
  ko_spikeball: 0,
  region_ranks: [],
  legends: [lifetimeLegend],
}

describe('Statistics V1 purpose-specific source evidence', () => {
  test('accepts ranked_1v1 evidence for the requested player', () => {
    expect(decodeRankedEvidence(ranked, playerId)).toEqual({
      brawlhallaId: playerId,
      games: 20,
      wins: 12,
      rating: 2100,
      peakRating: 2200,
      tier: 'Diamond',
      region: 'EU',
      legends: [{ legendId: 3, games: 10, wins: 6, rating: 2050, peakRating: 2150, tier: 'Diamond' }],
    })
  })

  test('preserves an omitted top-level ranked tier as unknown while keeping legend tiers strict', () => {
    const { tier: _omitted, ...withoutTier } = ranked
    expect(decodeRankedEvidence(withoutTier, playerId)).toMatchObject({
      brawlhallaId: playerId,
      tier: null,
      legends: [{ tier: 'Diamond' }],
    })
    expect(validateRankedEvidence(decodeRankedEvidence(withoutTier, playerId), playerId).tier).toBeNull()
    expect(() => decodeRankedEvidence({ ...withoutTier, tier: 1 }, playerId)).toThrow('tier')
    expect(() =>
      decodeRankedEvidence(
        {
          ...withoutTier,
          legends: [{ ...withoutTier.legends[0], tier: undefined }],
        },
        playerId,
      ),
    ).toThrow('legends[0].tier')
  })

  test('accepts all-mode lifetime evidence with weapon-held facts', () => {
    const decoded = decodeLifetimeEvidence(lifetime, playerId)
    expect(decoded).toMatchObject({
      brawlhallaId: playerId,
      games: 100,
      wins: 60,
      legends: [
        {
          legendId: 3,
          games: 50,
          wins: 30,
          damageWeaponOne: 400,
          damageWeaponTwo: 300,
          koWeaponOne: 15,
          koWeaponTwo: 12,
          timeHeldWeaponOne: 1200,
          timeHeldWeaponTwo: 1500,
        },
      ],
    })
  })

  test('revalidates canonical evidence at the Statistics persistence boundary', () => {
    expect(validateRankedEvidence(decodeRankedEvidence(ranked, playerId), playerId).brawlhallaId).toBe(playerId)
    expect(validateLifetimeEvidence(decodeLifetimeEvidence(lifetime, playerId), playerId).brawlhallaId).toBe(playerId)
    expect(() => validateRankedEvidence({ legends: [] }, playerId)).toThrow('brawlhallaId')
    expect(() => validateLifetimeEvidence({ legends: [] }, playerId)).toThrow('brawlhallaId')
  })

  test.each([
    [ranked, playerId + 1],
    [{ ...ranked, legends: [{ ...ranked.legends[0], wins: 11 }] }, playerId],
    [{ ...ranked, rating: Number.NaN }, playerId],
    [{ ...ranked, teams: [] }, playerId],
  ])('rejects wrong-player, contradictory, malformed, or team-bearing ranked evidence %#', (payload, requestedId) => {
    expect(() => decodeRankedEvidence(payload, requestedId)).toThrow()
  })

  test.each([
    [lifetime, playerId + 1],
    [{ ...lifetime, legends: [{ ...lifetimeLegend, time_held_weapon_one: undefined }] }, playerId],
    [{ ...lifetime, guild: {} }, playerId],
    [{ ...lifetime, wins: 101 }, playerId],
    [
      {
        ...lifetime,
        legends: Array.from({ length: 101 }, (_, index) => ({ ...lifetimeLegend, legend_id: index + 1 })),
      },
      playerId,
    ],
  ])('rejects wrong-player, partial, guild-bearing, or contradictory lifetime evidence %#', (payload, requestedId) => {
    expect(() => decodeLifetimeEvidence(payload, requestedId)).toThrow()
  })
})
