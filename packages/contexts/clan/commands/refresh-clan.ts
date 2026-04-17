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
  const data = await bhapi.getClan(clanId, { caller })
  if (!data) return

  await db.transaction(async (tx) => {
    await tx
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

    await tx.delete(clanMember).where(eq(clanMember.clanId, data.clan_id))
    if (data.clan.length > 0) {
      await tx.insert(clanMember).values(
        data.clan.map((m) => ({
          clanId: data.clan_id,
          brawlhallaId: m.brawlhalla_id,
          name: m.name,
          rank: m.rank,
          joinDate: new Date(m.join_date * 1000),
          xp: m.xp,
        })),
      )
    }
  })
}
