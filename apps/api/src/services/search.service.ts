import { blacklist, clan, player, playerAlias } from '@brawltome/database'
import { and, desc, eq, ilike, inArray, not, sql } from 'drizzle-orm'
import type { Context } from '../trpc/context'
import { getLegendById } from './game-data.service'

function sanitizeQuery(query: string): string {
  return query
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/[^a-zA-Z0-9_\-\s|]/g, '')
    .trim()
}

export async function searchLocal(ctx: Context, rawQuery: string) {
  const query = sanitizeQuery(rawQuery)
  if (query.length < 2) return { players: [], clans: [] }

  const blacklistedIds = await ctx.db.select({ brawlhallaId: blacklist.brawlhallaId }).from(blacklist)
  const blacklistSet = new Set(blacklistedIds.map((b) => b.brawlhallaId))

  const playersByName = await ctx.db.query.player.findMany({
    where: and(
      sql`(${player.name} ILIKE ${`${query}%`} OR ${player.name} ILIKE ${`% | ${query}%`})`,
      blacklistSet.size > 0 ? not(inArray(player.brawlhallaId, [...blacklistSet])) : undefined,
    ),
    orderBy: [desc(player.rating), desc(player.viewCount)],
    limit: 50,
  })

  const aliasMatches = await ctx.db
    .select({ brawlhallaId: playerAlias.brawlhallaId })
    .from(playerAlias)
    .where(ilike(playerAlias.key, `${query.toLowerCase()}%`))
    .limit(50)

  const aliasIds = aliasMatches
    .map((a) => a.brawlhallaId)
    .filter((id) => !blacklistSet.has(id) && !playersByName.some((p) => p.brawlhallaId === id))

  let playersByAlias: typeof playersByName = []
  if (aliasIds.length > 0) {
    playersByAlias = await ctx.db.query.player.findMany({
      where: inArray(player.brawlhallaId, aliasIds),
      orderBy: [desc(player.rating)],
      limit: 20,
    })
  }

  const players = [...playersByName, ...playersByAlias].slice(0, 40).map((p) => ({
    ...p,
    bestLegendNameKey: p.bestLegend != null ? (getLegendById(p.bestLegend)?.legendNameKey ?? null) : null,
  }))

  // Search clans
  const clans = await ctx.db.query.clan.findMany({
    where: ilike(clan.clanName, `${query}%`),
    orderBy: [desc(clan.clanXp)],
    limit: 5,
  })

  return { players, clans }
}
