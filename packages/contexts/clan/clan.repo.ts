import type { Database } from '@brawltome/database'
import { clan, clanMember, player } from '@brawltome/database'
import { eq, inArray } from 'drizzle-orm'

export function createClanRepo(db: Database) {
  return {
    findById(clanId: number) {
      return db.query.clan.findFirst({
        where: eq(clan.clanId, clanId),
        with: { members: true },
      })
    },

    async getMemberRatings(memberIds: number[]) {
      if (memberIds.length === 0) return new Map()
      const players = await db
        .select({
          brawlhallaId: player.brawlhallaId,
          rating: player.rating,
          peakRating: player.peakRating,
        })
        .from(player)
        .where(inArray(player.brawlhallaId, memberIds))
      return new Map(players.map((p) => [p.brawlhallaId, { rating: p.rating, peakRating: p.peakRating }]))
    },

    async upsertClan(data: {
      clan_id: number
      clan_name: string
      clan_create_date: number
      clan_xp: string
      clan_lifetime_xp: string
    }) {
      await db
        .insert(clan)
        .values({
          clanId: data.clan_id,
          clanName: data.clan_name,
          clanCreateDate: new Date(data.clan_create_date * 1000),
          clanXp: BigInt(data.clan_xp || '0'),
          clanLifetimeXp: BigInt(data.clan_lifetime_xp),
          lastUpdated: new Date(),
        })
        .onConflictDoUpdate({
          target: clan.clanId,
          set: {
            clanName: data.clan_name,
            clanXp: BigInt(data.clan_xp || '0'),
            clanLifetimeXp: BigInt(data.clan_lifetime_xp),
            lastUpdated: new Date(),
          },
        })
    },

    async replaceMembers(
      clanId: number,
      members: Array<{
        brawlhalla_id: number
        name: string
        rank: string
        join_date: number
        xp: number
      }>,
    ) {
      await db.delete(clanMember).where(eq(clanMember.clanId, clanId))
      if (members.length > 0) {
        await db.insert(clanMember).values(
          members.map((m) => ({
            clanId,
            brawlhallaId: m.brawlhalla_id,
            name: m.name,
            rank: m.rank,
            joinDate: new Date(m.join_date * 1000),
            xp: m.xp,
          })),
        )
      }
    },

    transaction: db.transaction.bind(db),
  }
}

export type ClanRepo = ReturnType<typeof createClanRepo>
