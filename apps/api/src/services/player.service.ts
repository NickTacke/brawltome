import {
  blacklist,
  player,
  playerClan,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
} from '@brawltome/database'
import { TRPCError } from '@trpc/server'
import { desc, eq, sql } from 'drizzle-orm'
import { dedupKey, tryDedup } from '../queue/dedup'
import type { Context } from '../trpc/context'
import {
  DEDUP_TTL_RANKED_SEC,
  DEDUP_TTL_STATS_SEC,
  DISCOVERY_MIN_TOKENS,
  QUEUE_DISCOVERY_CAP,
  TIERED_TTL,
} from './constants'
import { aggregateWeapons, getLegendById, normalizeWeaponName } from './game-data.service'
import { checkRateLimit } from './rate-limit.service'

const discoveries = new Map<number, Promise<PlayerResult | null>>()

type QueryResult = NonNullable<Awaited<ReturnType<typeof queryPlayer>>>
type EnrichedStatsLegend = QueryResult['statsLegends'][number] & {
  weaponOne: string | null
  weaponTwo: string | null
  bioName: string | null
}
type PlayerResult = Omit<QueryResult, 'statsLegends'> & {
  statsLegends: EnrichedStatsLegend[]
  ratingHistory: (typeof ratingHistory.$inferSelect)[]
  isRefreshing: boolean
}

async function queryPlayer(ctx: Context, brawlhallaId: number) {
  return ctx.db.query.player.findFirst({
    where: eq(player.brawlhallaId, brawlhallaId),
    with: {
      aliases: true,
      statsLegends: true,
      weaponStats: true,
      clan: true,
      rankedLegends: true,
      rankedTeams: true,
    },
  })
}

export async function getPlayer(ctx: Context, brawlhallaId: number): Promise<PlayerResult | null> {
  const blocked = await ctx.db.query.blacklist.findFirst({
    where: eq(blacklist.brawlhallaId, brawlhallaId),
  })
  if (blocked) return null

  const p = await queryPlayer(ctx, brawlhallaId)

  if (!p) {
    return discoverPlayer(ctx, brawlhallaId)
  }

  // Update view count and refresh tier
  const now = new Date()
  await ctx.db
    .update(player)
    .set({
      viewCount: sql`${player.viewCount} + 1`,
      lastViewedAt: now,
      refreshTier: 'hot',
    })
    .where(eq(player.brawlhallaId, brawlhallaId))

  // Use hot TTL since we just promoted the player — any viewed player should refresh aggressively
  const ttl = TIERED_TTL.hot
  let isRefreshing = false

  const rankedStale = !p.rankedLastUpdated || now.getTime() - p.rankedLastUpdated.getTime() > ttl.ranked
  if (rankedStale) {
    const canDedup = await tryDedup(ctx.redis, dedupKey('ranked', brawlhallaId), DEDUP_TTL_RANKED_SEC)
    if (canDedup) {
      const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
      if (refreshLimit.allowed) {
        await ctx.rankedQueue.enqueue({ brawlhallaId })
        isRefreshing = true
      }
    }
  }

  const statsStale = !p.statsLastUpdated || now.getTime() - p.statsLastUpdated.getTime() > ttl.stats
  if (statsStale) {
    const canDedup = await tryDedup(ctx.redis, dedupKey('stats', brawlhallaId), DEDUP_TTL_STATS_SEC)
    if (canDedup) {
      const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
      if (refreshLimit.allowed) {
        await ctx.statsQueue.enqueue({ brawlhallaId })
        isRefreshing = true
      }
    }
  }

  const history = await ctx.db.query.ratingHistory.findMany({
    where: eq(ratingHistory.brawlhallaId, brawlhallaId),
    orderBy: [desc(ratingHistory.recordedAt)],
    limit: 365,
  })

  // Enrich stats legends with weapon names from game data cache
  const enrichedStatsLegends = (p.statsLegends || []).map((l: (typeof p.statsLegends)[number]) => {
    const legendData = getLegendById(l.legendId)
    return {
      ...l,
      weaponOne: legendData ? normalizeWeaponName(legendData.weaponOne) : null,
      weaponTwo: legendData ? normalizeWeaponName(legendData.weaponTwo) : null,
      bioName: legendData?.bioName ?? null,
    }
  })

  return { ...p, statsLegends: enrichedStatsLegends, ratingHistory: history, isRefreshing }
}

async function discoverPlayer(ctx: Context, brawlhallaId: number): Promise<PlayerResult | null> {
  const existing = discoveries.get(brawlhallaId)
  if (existing) return existing

  const queueDepth = (await ctx.rankedQueue.depth()) + (await ctx.statsQueue.depth())
  if (queueDepth > QUEUE_DISCOVERY_CAP) return null
  if (ctx.bhapi.remainingTokens < DISCOVERY_MIN_TOKENS) return null

  const discoveryLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'discovery')
  if (!discoveryLimit.allowed) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Rate limited. Retry after ${discoveryLimit.retryAfter} seconds.`,
    })
  }

  const parseDmg = (s: string): bigint => BigInt(s || '0')

  const promise = (async () => {
    try {
      const stats = await ctx.bhapi.getPlayerStats(brawlhallaId)
      if (!stats?.name) return null

      const ranked = await ctx.bhapi.getPlayerRanked(brawlhallaId)

      const now = new Date()
      const filteredLegends = stats.legends.filter((l) => l.legend_id !== 0)
      const matchTimeTotal = filteredLegends.reduce((sum, l) => sum + l.matchtime, 0)

      // Compute best legend from ranked legends
      const bestLegend = (ranked?.legends ?? []).reduce(
        (best, l) => (l.games > best.games ? { id: l.legend_id, games: l.games, wins: l.wins } : best),
        { id: 0, games: 0, wins: 0 },
      )

      await ctx.db.transaction(async (tx) => {
        // Insert full player row
        await tx
          .insert(player)
          .values({
            brawlhallaId,
            name: stats.name,
            region: ranked?.region ?? null,
            rating: ranked?.rating ?? 0,
            peakRating: ranked?.peak_rating ?? 0,
            tier: ranked?.tier ?? null,
            rankedGames: ranked?.games ?? 0,
            rankedWins: ranked?.wins ?? 0,
            bestLegend: bestLegend.id,
            bestLegendGames: bestLegend.games,
            bestLegendWins: bestLegend.wins,
            xp: stats.xp,
            level: stats.level,
            xpPercentage: stats.xp_percentage,
            totalGames: stats.games,
            totalWins: stats.wins,
            matchTimeTotal,
            damageBomb: parseDmg(stats.damagebomb),
            damageMine: parseDmg(stats.damagemine),
            damageSpikeball: parseDmg(stats.damagespikeball),
            damageSidekick: parseDmg(stats.damagesidekick),
            hitSnowball: stats.hitsnowball,
            koBomb: stats.kobomb,
            koMine: stats.komine,
            koSpikeball: stats.kospikeball,
            koSidekick: stats.kosidekick,
            koSnowball: stats.kosnowball,
            refreshTier: 'hot',
            rankedLastUpdated: now,
            statsLastUpdated: now,
            lastUpdated: now,
          })
          .onConflictDoNothing()

        // Insert ranked legends
        if (ranked && ranked.legends.length > 0) {
          await tx.insert(playerRankedLegend).values(
            ranked.legends.map((l) => ({
              brawlhallaId,
              legendId: l.legend_id,
              legendNameKey: l.legend_name_key,
              rating: l.rating,
              peakRating: l.peak_rating,
              tier: l.tier,
              wins: l.wins,
              games: l.games,
            })),
          )
        }

        // Insert ranked teams (deduplicated)
        if (ranked && ranked['2v2'].length > 0) {
          const seen = new Set<string>()
          const teams = ranked['2v2'].filter((t) => {
            const key = `${t.brawlhalla_id_one}:${t.brawlhalla_id_two}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })

          await tx.insert(playerRankedTeam).values(
            teams.map((t) => ({
              brawlhallaId,
              brawlhallaIdOne: t.brawlhalla_id_one,
              brawlhallaIdTwo: t.brawlhalla_id_two,
              teamName: t.teamname,
              rating: t.rating,
              peakRating: t.peak_rating,
              tier: t.tier,
              wins: t.wins,
              games: t.games,
              region: String(t.region),
              globalRank: t.global_rank,
            })),
          )
        }

        // Insert stats legends
        if (filteredLegends.length > 0) {
          await tx.insert(playerStatsLegend).values(
            filteredLegends.map((l) => ({
              brawlhallaId,
              legendId: l.legend_id,
              legendNameKey: l.legend_name_key,
              xp: l.xp,
              level: l.level,
              xpPercentage: l.xp_percentage,
              games: l.games,
              wins: l.wins,
              matchTime: l.matchtime,
              kos: l.kos,
              teamKos: l.teamkos,
              suicides: l.suicides,
              falls: l.falls,
              damageDealt: parseDmg(l.damagedealt),
              damageTaken: parseDmg(l.damagetaken),
              damageWeaponOne: parseDmg(l.damageweaponone),
              damageWeaponTwo: parseDmg(l.damageweapontwo),
              timeHeldWeaponOne: l.timeheldweaponone,
              timeHeldWeaponTwo: l.timeheldweapontwo,
              koWeaponOne: l.koweaponone,
              koWeaponTwo: l.koweapontwo,
              koUnarmed: l.kounarmed,
              koThrownItem: l.kothrownitem,
              koGadgets: l.kogadgets,
              damageUnarmed: parseDmg(l.damageunarmed),
              damageThrownItem: parseDmg(l.damagethrownitem),
              damageGadgets: parseDmg(l.damagegadgets),
            })),
          )
        }

        // Insert weapon stats
        const weapons = aggregateWeapons(
          filteredLegends.map((l) => ({
            legendId: l.legend_id,
            damageWeaponOne: parseDmg(l.damageweaponone),
            damageWeaponTwo: parseDmg(l.damageweapontwo),
            timeHeldWeaponOne: l.timeheldweaponone,
            timeHeldWeaponTwo: l.timeheldweapontwo,
            koWeaponOne: l.koweaponone,
            koWeaponTwo: l.koweapontwo,
          })),
        )
        if (weapons.length > 0) {
          await tx.insert(playerWeaponStat).values(
            weapons.map((w) => ({
              brawlhallaId,
              weapon: w.weapon,
              timeHeld: w.timeHeld,
              damage: w.damage,
              kos: w.kos,
            })),
          )
        }

        // Insert clan association
        if (stats.clan) {
          await tx
            .insert(playerClan)
            .values({
              brawlhallaId,
              clanName: stats.clan.clan_name,
              clanId: stats.clan.clan_id,
              clanXp: parseDmg(stats.clan.clan_xp),
              clanLifetimeXp: BigInt(stats.clan.clan_lifetime_xp),
              personalXp: stats.clan.personal_xp,
            })
            .onConflictDoNothing()
        }

        // Insert initial rating history
        if (ranked && ranked.rating > 0) {
          await tx.insert(ratingHistory).values({
            brawlhallaId,
            rating: ranked.rating,
            peakRating: ranked.peak_rating,
            tier: ranked.tier,
            games: ranked.games,
            wins: ranked.wins,
          })
        }
      })

      // Query the just-inserted player and return enriched result
      const p = await queryPlayer(ctx, brawlhallaId)
      if (!p) return null

      const enrichedStatsLegends = (p.statsLegends || []).map((l: (typeof p.statsLegends)[number]) => {
        const legendData = getLegendById(l.legendId)
        return {
          ...l,
          weaponOne: legendData ? normalizeWeaponName(legendData.weaponOne) : null,
          weaponTwo: legendData ? normalizeWeaponName(legendData.weaponTwo) : null,
          bioName: legendData?.bioName ?? null,
        }
      })

      const history = await ctx.db.query.ratingHistory.findMany({
        where: eq(ratingHistory.brawlhallaId, brawlhallaId),
        orderBy: [desc(ratingHistory.recordedAt)],
        limit: 365,
      })

      return { ...p, statsLegends: enrichedStatsLegends, ratingHistory: history, isRefreshing: false }
    } finally {
      discoveries.delete(brawlhallaId)
    }
  })()

  discoveries.set(brawlhallaId, promise)
  setTimeout(() => discoveries.delete(brawlhallaId), 30_000)

  return promise
}
