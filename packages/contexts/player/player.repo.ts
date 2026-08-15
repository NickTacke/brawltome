import type { Database } from '@brawltome/database'
import {
  player,
  playerAlias,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
} from '@brawltome/database'
import { getLegendById } from '@brawltome/shared'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import {
  getCareerMainLegend,
  getEffectiveBestLegend,
  getEffectiveBestLegendsBatch,
} from './queries/get-effective-best-legend'

export function createPlayerRepo(db: Database) {
  return {
    async findById(brawlhallaId: number) {
      const p = await db.query.player.findFirst({
        where: eq(player.brawlhallaId, brawlhallaId),
        with: {
          aliases: true,
          statsLegends: true,
          weaponStats: true,
          rankedLegends: true,
          rankedTeams: true,
        },
      })
      if (!p) return p
      // playerRankedTeam can hold a per-player row (region from API) AND a leaderboard 'all' row
      // for the same team — dedupe by unordered pair, preferring the non-'all' row.
      const byPair = new Map<string, (typeof p.rankedTeams)[number]>()
      for (const t of p.rankedTeams) {
        const a = Math.min(t.brawlhallaIdOne, t.brawlhallaIdTwo)
        const b = Math.max(t.brawlhallaIdOne, t.brawlhallaIdTwo)
        const key = `${a}:${b}`
        const existing = byPair.get(key)
        if (!existing || (existing.region === 'all' && t.region !== 'all')) byPair.set(key, t)
      }
      p.rankedTeams = [...byPair.values()]
      const enrichedLegends = p.statsLegends.map((s) => {
        const meta = getLegendById(s.legendId)
        return { ...s, weaponOne: meta?.weaponOne ?? null, weaponTwo: meta?.weaponTwo ?? null }
      })
      return { ...p, statsLegends: enrichedLegends }
    },

    getRatingHistory(brawlhallaId: number, limit = 365) {
      return db.query.ratingHistory.findMany({
        where: eq(ratingHistory.brawlhallaId, brawlhallaId),
        orderBy: [desc(ratingHistory.recordedAt)],
        limit,
      })
    },

    incrementViewCount(brawlhallaId: number) {
      return db
        .update(player)
        .set({
          viewCount: sql`${player.viewCount} + 1`,
          lastViewedAt: new Date(),
          refreshTier: 'hot' as const,
        })
        .where(eq(player.brawlhallaId, brawlhallaId))
    },

    createPlaceholder(brawlhallaId: number) {
      return db
        .insert(player)
        .values({
          brawlhallaId,
          name: `Player ${brawlhallaId}`,
          refreshTier: 'hot',
          lastUpdated: new Date(),
        })
        .onConflictDoNothing()
    },

    getExistingPlayerMeta(brawlhallaId: number) {
      return db.query.player.findFirst({
        where: eq(player.brawlhallaId, brawlhallaId),
        columns: { name: true, tier: true, valhallanConfirmedAt: true },
      })
    },

    getExistingRankedState(brawlhallaId: number) {
      return db.query.player.findFirst({
        where: eq(player.brawlhallaId, brawlhallaId),
        columns: { rating: true, rankedGames: true, tier: true },
      })
    },

    updateRanked(
      brawlhallaId: number,
      data: {
        name?: string
        region: string
        rating: number
        peakRating: number
        tier: string | null
        rankedGames: number
        rankedWins: number
        bestLegend: number
        bestLegendGames: number
        bestLegendWins: number
      },
    ) {
      return db
        .update(player)
        .set({
          ...(data.name ? { name: data.name } : {}),
          region: data.region,
          rating: data.rating,
          peakRating: data.peakRating,
          tier: data.tier,
          rankedGames: data.rankedGames,
          rankedWins: data.rankedWins,
          bestLegend: data.bestLegend,
          bestLegendGames: data.bestLegendGames,
          bestLegendWins: data.bestLegendWins,
          rankedLastUpdated: new Date(),
          lastUpdated: new Date(),
        })
        .where(eq(player.brawlhallaId, brawlhallaId))
    },

    markRankedChecked(brawlhallaId: number) {
      return db
        .update(player)
        .set({ rankedLastUpdated: new Date(), lastUpdated: new Date() })
        .where(eq(player.brawlhallaId, brawlhallaId))
    },

    upsertAlias(brawlhallaId: number, oldName: string) {
      return db
        .insert(playerAlias)
        .values({
          brawlhallaId,
          key: oldName.toLowerCase(),
          value: oldName,
        })
        .onConflictDoNothing()
    },

    async replaceRankedLegends(
      brawlhallaId: number,
      legends: Array<{
        legend_id: number
        legend_name_key: string
        rating: number
        peak_rating: number
        tier: string
        wins: number
        games: number
      }>,
    ) {
      await db.transaction(async (tx) => {
        await tx.delete(playerRankedLegend).where(eq(playerRankedLegend.brawlhallaId, brawlhallaId))
        if (legends.length > 0) {
          await tx.insert(playerRankedLegend).values(
            legends.map((l) => ({
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
      })
    },

    getExistingRankedLegends(brawlhallaId: number) {
      return db.query.playerRankedLegend.findMany({
        where: eq(playerRankedLegend.brawlhallaId, brawlhallaId),
        columns: { legendId: true, legendNameKey: true },
      })
    },

    getExistingStatsLegends(brawlhallaId: number) {
      return db.query.playerStatsLegend.findMany({
        where: eq(playerStatsLegend.brawlhallaId, brawlhallaId),
        columns: {
          legendId: true,
          legendNameKey: true,
          xp: true,
          level: true,
          xpPercentage: true,
        },
      })
    },

    getExistingRankedTeams(brawlhallaId: number) {
      return db.query.playerRankedTeam.findMany({
        where: eq(playerRankedTeam.brawlhallaId, brawlhallaId),
        columns: {
          brawlhallaIdOne: true,
          brawlhallaIdTwo: true,
          tier: true,
          valhallanConfirmedAt: true,
        },
      })
    },

    async replaceRankedTeams(
      brawlhallaId: number,
      teams: Array<{
        brawlhallaIdOne: number
        brawlhallaIdTwo: number
        teamName: string
        rating: number
        peakRating: number
        tier: string
        wins: number
        games: number
        region: string
        valhallanConfirmedAt: Date | null
      }>,
    ) {
      await db.transaction(async (tx) => {
        await tx.delete(playerRankedTeam).where(eq(playerRankedTeam.brawlhallaId, brawlhallaId))
        if (teams.length > 0) {
          await tx.insert(playerRankedTeam).values(teams.map((t) => ({ brawlhallaId, ...t })))
        }
      })
    },

    getLastRatingSnapshot(brawlhallaId: number) {
      return db.query.ratingHistory.findFirst({
        where: eq(ratingHistory.brawlhallaId, brawlhallaId),
        orderBy: [desc(ratingHistory.recordedAt)],
      })
    },

    insertRatingSnapshot(data: {
      brawlhallaId: number
      rating: number
      peakRating: number
      tier: string
      games: number
      wins: number
    }) {
      return db.insert(ratingHistory).values(data)
    },

    updateStats(
      brawlhallaId: number,
      data: {
        name: string
        xp?: number
        level?: number
        xpPercentage?: number
        totalGames: number
        totalWins: number
        matchTimeTotal: number
        damageBomb: bigint
        damageMine: bigint
        damageSpikeball: bigint
        damageSidekick: bigint
        hitSnowball: number
        koBomb: number
        koMine: number
        koSpikeball: number
        koSidekick: number
        koSnowball: number
      },
    ) {
      return db
        .update(player)
        .set({
          ...data,
          statsLastUpdated: new Date(),
          lastUpdated: new Date(),
        })
        .where(eq(player.brawlhallaId, brawlhallaId))
    },

    async replaceStatsLegends(
      brawlhallaId: number,
      legends: Array<Omit<typeof playerStatsLegend.$inferInsert, 'brawlhallaId'>>,
    ) {
      await db.transaction(async (tx) => {
        await tx.delete(playerStatsLegend).where(eq(playerStatsLegend.brawlhallaId, brawlhallaId))
        if (legends.length > 0) {
          await tx.insert(playerStatsLegend).values(legends.map((l) => ({ ...l, brawlhallaId })))
        }
      })
    },

    async replaceWeaponStats(
      brawlhallaId: number,
      weapons: Array<{
        weapon: string
        timeHeld: number
        damage: bigint
        kos: number
      }>,
    ) {
      await db.transaction(async (tx) => {
        await tx.delete(playerWeaponStat).where(eq(playerWeaponStat.brawlhallaId, brawlhallaId))
        if (weapons.length > 0) {
          await tx.insert(playerWeaponStat).values(weapons.map((w) => ({ brawlhallaId, ...w })))
        }
      })
    },

    getPlayerNames(playerIds: number[]) {
      if (playerIds.length === 0) return Promise.resolve(new Map<number, string>())
      return db
        .select({ brawlhallaId: player.brawlhallaId, name: player.name })
        .from(player)
        .where(inArray(player.brawlhallaId, playerIds))
        .then((rows) => new Map(rows.map((p) => [p.brawlhallaId, p.name])))
    },

    getPlayerRegions(playerIds: number[]) {
      if (playerIds.length === 0) return Promise.resolve(new Map<number, string>())
      return db
        .select({ brawlhallaId: player.brawlhallaId, region: player.region })
        .from(player)
        .where(inArray(player.brawlhallaId, playerIds))
        .then((rows) => new Map(rows.filter((r) => r.region).map((r) => [r.brawlhallaId, r.region as string])))
    },

    getPlayersByIds(ids: number[]) {
      return db.query.player.findMany({
        where: inArray(player.brawlhallaId, ids),
        orderBy: [desc(player.rating)],
        limit: 20,
      })
    },

    getExistingPlayerNames(ids: number[]) {
      return db.query.player
        .findMany({
          where: inArray(player.brawlhallaId, ids),
          columns: { brawlhallaId: true, name: true },
        })
        .then((rows) => new Map(rows.map((p) => [p.brawlhallaId, p.name])))
    },

    getCareerMainLegend(brawlhallaId: number) {
      return getCareerMainLegend(db, brawlhallaId)
    },

    getEffectiveBestLegend(brawlhallaId: number) {
      return getEffectiveBestLegend(db, brawlhallaId)
    },

    getEffectiveBestLegendsBatch(brawlhallaIds: number[]) {
      return getEffectiveBestLegendsBatch(db, brawlhallaIds)
    },

    transaction: db.transaction.bind(db),
  }
}

export type PlayerRepo = ReturnType<typeof createPlayerRepo>
