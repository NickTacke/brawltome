import type { BhApiClient } from '@brawltome/bhapi'
import { clan, clanMember } from '@brawltome/database'
import type { Database } from '@brawltome/database'
import { eq } from 'drizzle-orm'

interface RefreshDeps {
  db: Database
  bhapi: BhApiClient
}

export async function processRefreshClan(
  { db, bhapi }: RefreshDeps,
  clanId: number,
  caller: 'on-demand' | 'background' = 'background',
) {
  const guildStats = await bhapi.getGuildStatsV1(clanId, { caller })
  if (!guildStats) return

  // Fetch members outside the transaction; null means skip member replacement
  const guildMembers = await bhapi.getGuildMembersV1(clanId, { caller })

  await db.transaction(async (tx) => {
    await tx
      .insert(clan)
      .values({
        clanId: guildStats.guild_id,
        clanName: guildStats.name,
        clanCreateDate: new Date(guildStats.create_date * 1000),
        clanXp: BigInt(guildStats.xp),
        clanLifetimeXp: BigInt(guildStats.legacy_xp + guildStats.xp),
        lastUpdated: new Date(),
      })
      .onConflictDoUpdate({
        target: clan.clanId,
        set: {
          clanName: guildStats.name,
          clanXp: BigInt(guildStats.xp),
          clanLifetimeXp: BigInt(guildStats.legacy_xp + guildStats.xp),
          lastUpdated: new Date(),
        },
      })

    if (guildMembers !== null) {
      await tx.delete(clanMember).where(eq(clanMember.clanId, guildStats.guild_id))
      if (guildMembers.guild_members.length > 0) {
        await tx.insert(clanMember).values(
          guildMembers.guild_members.map((m) => ({
            clanId: guildStats.guild_id,
            brawlhallaId: m.brawlhalla_id,
            name: m.name,
            rank: m.rank,
            joinDate: new Date(m.join_date * 1000),
            xp: m.xp,
          })),
        )
      }
    }
  })
}
