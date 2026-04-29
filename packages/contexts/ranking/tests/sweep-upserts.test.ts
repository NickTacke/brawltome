import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { db, player, playerRankedTeam } from '@brawltome/database'
import { createPlayerRepo } from '@brawltome/player'
import { eq, inArray, sql } from 'drizzle-orm'

const repo = createPlayerRepo(db)

const ALL_IDS = [9_900_001, 9_900_002, 9_900_010, 9_900_020, 9_900_021, 9_900_030]

async function reset(ids: number[]) {
  if (ids.length === 0) return
  await db.delete(playerRankedTeam).where(inArray(playerRankedTeam.brawlhallaId, ids))
  await db.delete(player).where(inArray(player.brawlhallaId, ids))
}

beforeEach(() => reset(ALL_IDS))
afterAll(() => reset(ALL_IDS))

describe('sweepUpsert1v1', () => {
  it('inserts new players with synced_at_1v1 set and aliases empty', async () => {
    await repo.sweepUpsert1v1([
      {
        brawlhallaId: 9_900_001,
        name: 'NewPlayer',
        region: 'EU',
        rating: 1800,
        peakRating: 1850,
        tier: 'Diamond',
        wins: 50,
        losses: 30,
      },
    ])
    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, 9_900_001) })
    expect(row?.name).toBe('NewPlayer')
    expect(row?.rating).toBe(1800)
    expect(row?.rankedGames).toBe(80)
    expect(row?.tier).toBe('Diamond')
    expect(row?.syncedAt1v1).not.toBeNull()
  })

  it('updates existing player and inserts an alias when name changes', async () => {
    await repo.sweepUpsert1v1([
      { brawlhallaId: 9_900_002, name: 'OldName', region: 'EU', rating: 1500, peakRating: 1500, tier: 'Gold', wins: 10, losses: 5 },
    ])
    await repo.sweepUpsert1v1([
      { brawlhallaId: 9_900_002, name: 'NewName', region: 'EU', rating: 1600, peakRating: 1600, tier: 'Gold', wins: 12, losses: 5 },
    ])
    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, 9_900_002), with: { aliases: true } })
    expect(row?.name).toBe('NewName')
    expect(row?.aliases.find((a) => a.value === 'OldName')).toBeDefined()
  })
})

describe('sweepUpsert3v3', () => {
  it('writes 3v3 columns and synced_at_3v3, leaving 1v1 columns untouched', async () => {
    await repo.sweepUpsert1v1([
      { brawlhallaId: 9_900_010, name: 'P', region: 'EU', rating: 1500, peakRating: 1500, tier: 'Gold', wins: 1, losses: 1 },
    ])
    await repo.sweepUpsert3v3([
      { brawlhallaId: 9_900_010, name: 'P', region: 'EU', rating: 1700, peakRating: 1750, tier: 'Platinum', wins: 5, losses: 2 },
    ])
    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, 9_900_010) })
    expect(row?.rating).toBe(1500)
    expect(row?.rating3v3).toBe(1700)
    expect(row?.tier3v3).toBe('Platinum')
    expect(row?.syncedAt3v3).not.toBeNull()
  })
})

describe('sweepUpsert2v2', () => {
  it('writes two rows per team (one per owner) without globalRank', async () => {
    await repo.sweepUpsert2v2([
      {
        brawlhallaIdOne: 9_900_020,
        brawlhallaIdTwo: 9_900_021,
        teamName: 'team',
        rating: 1800,
        peakRating: 1850,
        tier: 'Diamond',
        wins: 40,
        losses: 20,
        region: 'EU',
      },
    ])
    const rows = await db.select().from(playerRankedTeam).where(sql`${playerRankedTeam.brawlhallaIdOne} = 9900020`)
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.region === 'EU')).toBe(true)
    expect(rows.every((r) => r.globalRank === null)).toBe(true)
  })
})

describe('sweepUpsertSolo2v2', () => {
  it('writes one row with brawlhalla_id_two = 0', async () => {
    await repo.sweepUpsertSolo2v2([
      {
        brawlhallaId: 9_900_030,
        name: 'P',
        teamName: '',
        rating: 1700,
        peakRating: 1700,
        tier: 'Platinum',
        wins: 30,
        losses: 15,
        region: 'EU',
      },
    ])
    const rows = await db.select().from(playerRankedTeam).where(sql`${playerRankedTeam.brawlhallaId} = 9900030`)
    expect(rows.length).toBe(1)
    expect(rows[0].brawlhallaIdOne).toBe(9_900_030)
    expect(rows[0].brawlhallaIdTwo).toBe(0)
  })
})
