import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db, player, playerStatsLegend } from '@brawltome/database'
import { initGameData } from '@brawltome/shared'
import { inArray } from 'drizzle-orm'
import { getEffectiveBestLegend, getEffectiveBestLegendsBatch } from '../queries/get-effective-best-legend'

const TEST_IDS = [990001, 990002, 990003]

beforeAll(async () => {
  await initGameData(db)

  await db.delete(playerStatsLegend).where(inArray(playerStatsLegend.brawlhallaId, TEST_IDS))
  await db.delete(player).where(inArray(player.brawlhallaId, TEST_IDS))

  await db.insert(player).values([
    { brawlhallaId: 990001, name: 'A', bestLegend: 35 },
    { brawlhallaId: 990002, name: 'B', bestLegend: 0 },
    { brawlhallaId: 990003, name: 'C', bestLegend: 0 },
  ])

  await db.insert(playerStatsLegend).values([
    {
      brawlhallaId: 990002,
      legendId: 10,
      legendNameKey: 'bodvar',
      xp: 1000,
      level: 15,
      xpPercentage: 0,
      games: 0,
      wins: 0,
      matchTime: 0,
      kos: 0,
      teamKos: 0,
      suicides: 0,
      falls: 0,
      damageDealt: 0n,
      damageTaken: 0n,
      damageWeaponOne: 0n,
      damageWeaponTwo: 0n,
      timeHeldWeaponOne: 0,
      timeHeldWeaponTwo: 0,
      koWeaponOne: 0,
      koWeaponTwo: 0,
      koUnarmed: 0,
      koThrownItem: 0,
      koGadgets: 0,
      damageUnarmed: 0n,
      damageThrownItem: 0n,
      damageGadgets: 0n,
    },
    {
      brawlhallaId: 990002,
      legendId: 20,
      legendNameKey: 'cassidy',
      xp: 500,
      level: 20,
      xpPercentage: 0,
      games: 0,
      wins: 0,
      matchTime: 0,
      kos: 0,
      teamKos: 0,
      suicides: 0,
      falls: 0,
      damageDealt: 0n,
      damageTaken: 0n,
      damageWeaponOne: 0n,
      damageWeaponTwo: 0n,
      timeHeldWeaponOne: 0,
      timeHeldWeaponTwo: 0,
      koWeaponOne: 0,
      koWeaponTwo: 0,
      koUnarmed: 0,
      koThrownItem: 0,
      koGadgets: 0,
      damageUnarmed: 0n,
      damageThrownItem: 0n,
      damageGadgets: 0n,
    },
  ])
})

afterAll(async () => {
  await db.delete(playerStatsLegend).where(inArray(playerStatsLegend.brawlhallaId, TEST_IDS))
  await db.delete(player).where(inArray(player.brawlhallaId, TEST_IDS))
})

describe('getEffectiveBestLegend', () => {
  it('returns explicit bestLegend when set', async () => {
    const result = await getEffectiveBestLegend(db, 990001)
    expect(result?.legendId).toBe(35)
  })

  it('falls back to highest-level stats legend when bestLegend is 0', async () => {
    const result = await getEffectiveBestLegend(db, 990002)
    expect(result?.legendId).toBe(20)
  })

  it('returns null when bestLegend is 0 and no stats legends exist', async () => {
    const result = await getEffectiveBestLegend(db, 990003)
    expect(result).toBeNull()
  })
})

describe('getEffectiveBestLegendsBatch', () => {
  it('returns a Map covering all three players', async () => {
    const result = await getEffectiveBestLegendsBatch(db, TEST_IDS)
    expect(result.get(990001)?.legendId).toBe(35)
    expect(result.get(990002)?.legendId).toBe(20)
    expect(result.has(990003)).toBe(false)
  })
})
