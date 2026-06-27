import { afterAll, describe, expect, it } from 'bun:test'
import type { BhV1Guild, BhV1GuildMembers } from '@brawltome/bhapi'
import { clan, clanMember, db } from '@brawltome/database'
import { eq } from 'drizzle-orm'
import { processRefreshClan } from '../commands/refresh-clan'

const TEST_CLAN_ID = 990070

const GUILD_STATS: BhV1Guild = {
  guild_id: TEST_CLAN_ID,
  name: 'TestClan',
  create_date: 1660000000,
  xp: 5000,
  legacy_xp: 45000,
  notice: '',
  tags: [],
  discord_invite_code: '',
  guild_points: 0,
  is_recruiting: false,
}

const GUILD_MEMBERS: BhV1GuildMembers = {
  guild_id: TEST_CLAN_ID,
  guild_members: [
    { brawlhalla_id: 1001, name: 'Alpha', rank: 'Leader', join_date: 1660100000, xp: 1000, guild_points: 100 },
    { brawlhalla_id: 1002, name: 'Beta', rank: 'Member', join_date: 1660200000, xp: 500, guild_points: 50 },
  ],
}

afterAll(async () => {
  await db.delete(clanMember).where(eq(clanMember.clanId, TEST_CLAN_ID))
  await db.delete(clan).where(eq(clan.clanId, TEST_CLAN_ID))
})

describe('processRefreshClan (v1)', () => {
  it('full refresh: upserts clan row and inserts 2 members', async () => {
    // Clean slate
    await db.delete(clanMember).where(eq(clanMember.clanId, TEST_CLAN_ID))
    await db.delete(clan).where(eq(clan.clanId, TEST_CLAN_ID))

    const bhapi = {
      getGuildStatsV1: async () => GUILD_STATS,
      getGuildMembersV1: async () => GUILD_MEMBERS,
    }

    await processRefreshClan({ db, bhapi: bhapi as never }, TEST_CLAN_ID)

    const clanRow = await db.query.clan.findFirst({ where: eq(clan.clanId, TEST_CLAN_ID) })
    expect(clanRow?.clanId).toBe(TEST_CLAN_ID)
    expect(clanRow?.clanName).toBe('TestClan')
    expect(clanRow?.clanXp).toBe(BigInt(GUILD_STATS.xp))
    expect(clanRow?.clanLifetimeXp).toBe(BigInt(GUILD_STATS.legacy_xp + GUILD_STATS.xp))
    expect(clanRow?.clanCreateDate).toEqual(new Date(GUILD_STATS.create_date * 1000))

    const members = await db.query.clanMember.findMany({ where: eq(clanMember.clanId, TEST_CLAN_ID) })
    expect(members).toHaveLength(2)

    const alpha = members.find((m) => m.brawlhallaId === 1001)
    expect(alpha).toBeDefined()
    expect(alpha?.name).toBe('Alpha')
    expect(alpha?.rank).toBe('Leader')
    expect(alpha?.xp).toBe(1000)
    expect(alpha?.joinDate).toEqual(new Date(GUILD_MEMBERS.guild_members[0].join_date * 1000))
  })

  it('guildMembers null preserves existing members and still updates clan row', async () => {
    // Pre-seed: clan row + one member
    await db.delete(clanMember).where(eq(clanMember.clanId, TEST_CLAN_ID))
    await db.delete(clan).where(eq(clan.clanId, TEST_CLAN_ID))

    await db.insert(clan).values({
      clanId: TEST_CLAN_ID,
      clanName: 'OldName',
      clanCreateDate: new Date(1660000000 * 1000),
      clanXp: BigInt(1),
      clanLifetimeXp: BigInt(1),
      lastUpdated: new Date(),
    })
    await db.insert(clanMember).values({
      clanId: TEST_CLAN_ID,
      brawlhallaId: 9999,
      name: 'Preserved',
      rank: 'Member',
      joinDate: new Date(1660000000 * 1000),
      xp: 42,
    })

    const bhapi = {
      getGuildStatsV1: async () => GUILD_STATS,
      getGuildMembersV1: async (): Promise<BhV1GuildMembers | null> => null,
    }

    await processRefreshClan({ db, bhapi: bhapi as never }, TEST_CLAN_ID)

    const clanRow = await db.query.clan.findFirst({ where: eq(clan.clanId, TEST_CLAN_ID) })
    expect(clanRow?.clanName).toBe('TestClan')
    expect(clanRow?.clanXp).toBe(BigInt(GUILD_STATS.xp))

    const members = await db.query.clanMember.findMany({ where: eq(clanMember.clanId, TEST_CLAN_ID) })
    expect(members).toHaveLength(1)
    expect(members[0].brawlhallaId).toBe(9999)
  })

  it('guildStats null is a no-op: no clan row created', async () => {
    await db.delete(clanMember).where(eq(clanMember.clanId, TEST_CLAN_ID))
    await db.delete(clan).where(eq(clan.clanId, TEST_CLAN_ID))

    const bhapi = {
      getGuildStatsV1: async (): Promise<BhV1Guild | null> => null,
      getGuildMembersV1: async () => GUILD_MEMBERS,
    }

    await processRefreshClan({ db, bhapi: bhapi as never }, TEST_CLAN_ID)

    const clanRow = await db.query.clan.findFirst({ where: eq(clan.clanId, TEST_CLAN_ID) })
    expect(clanRow).toBeUndefined()
  })
})
