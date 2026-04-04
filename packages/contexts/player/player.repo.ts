import type { Database } from '@brawltome/database'
import {
  blacklist,
  player,
  playerAlias,
  playerClan,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
} from '@brawltome/database'
import { and, asc, desc, eq, gt, ilike, inArray, not, or, sql } from 'drizzle-orm'

export function createPlayerRepo(db: Database) {
  return {
    findById(brawlhallaId: number) {
      return db.query.player.findFirst({
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
    },

    isBlacklisted(brawlhallaId: number) {
      return db.query.blacklist
        .findFirst({
          where: eq(blacklist.brawlhallaId, brawlhallaId),
        })
        .then((b) => !!b)
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
        globalRank: number
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
        xp: number
        level: number
        xpPercentage: number
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

    async upsertClan(
      brawlhallaId: number,
      data: {
        clan_name: string
        clan_id: number
        clan_xp: string | number
        clan_lifetime_xp: string | number
        personal_xp: number
      } | null,
    ) {
      if (data) {
        await db
          .insert(playerClan)
          .values({
            brawlhallaId,
            clanName: data.clan_name,
            clanId: data.clan_id,
            clanXp: BigInt(data.clan_xp || '0'),
            clanLifetimeXp: BigInt(data.clan_lifetime_xp),
            personalXp: data.personal_xp,
          })
          .onConflictDoUpdate({
            target: playerClan.brawlhallaId,
            set: {
              clanName: data.clan_name,
              clanId: data.clan_id,
              clanXp: BigInt(data.clan_xp || '0'),
              clanLifetimeXp: BigInt(data.clan_lifetime_xp),
              personalXp: data.personal_xp,
            },
          })
      } else {
        await db.delete(playerClan).where(eq(playerClan.brawlhallaId, brawlhallaId))
      }
    },

    get1v1Leaderboard(opts: {
      region: string
      sort: 'rating' | 'peakRating' | 'wins' | 'games'
      order: 'asc' | 'desc'
      pageSize: number
      offset: number
      blacklistSet: Set<number>
    }) {
      const sortColumn = {
        rating: player.rating,
        peakRating: player.peakRating,
        wins: player.rankedWins,
        games: player.rankedGames,
      }[opts.sort]
      const orderFn = opts.order === 'asc' ? asc : desc
      return db
        .select()
        .from(player)
        .where(
          and(
            gt(player.rating, 0),
            opts.region !== 'all' ? eq(player.region, opts.region) : undefined,
            opts.blacklistSet.size > 0 ? not(inArray(player.brawlhallaId, [...opts.blacklistSet])) : undefined,
          ),
        )
        .orderBy(orderFn(sortColumn))
        .limit(opts.pageSize)
        .offset(opts.offset)
    },

    get2v2Leaderboard(opts: {
      region: string
      sort: 'rating' | 'peakRating' | 'wins' | 'games'
      order: 'asc' | 'desc'
      pageSize: number
      offset: number
    }) {
      const sortColumn = {
        rating: playerRankedTeam.rating,
        peakRating: playerRankedTeam.peakRating,
        wins: playerRankedTeam.wins,
        games: playerRankedTeam.games,
      }[opts.sort]
      const orderFn = opts.order === 'asc' ? asc : desc
      const fetchLimit = (opts.offset + opts.pageSize) * 3

      return db
        .select()
        .from(playerRankedTeam)
        .where(
          and(
            gt(playerRankedTeam.rating, 0),
            gt(playerRankedTeam.games, 0),
            opts.region !== 'all' ? eq(playerRankedTeam.region, opts.region) : undefined,
          ),
        )
        .orderBy(orderFn(sortColumn))
        .limit(fetchLimit)
    },

    getPlayerNames(playerIds: number[]) {
      if (playerIds.length === 0) return Promise.resolve(new Map<number, string>())
      return db
        .select({ brawlhallaId: player.brawlhallaId, name: player.name })
        .from(player)
        .where(inArray(player.brawlhallaId, playerIds))
        .then((rows) => new Map(rows.map((p) => [p.brawlhallaId, p.name])))
    },

    searchPlayersByName(query: string, blacklistSet: Set<number>) {
      return db.query.player.findMany({
        where: and(
          or(ilike(player.name, `${query}%`), ilike(player.name, `% | ${query}%`)),
          blacklistSet.size > 0 ? not(inArray(player.brawlhallaId, [...blacklistSet])) : undefined,
        ),
        orderBy: [desc(player.rating), desc(player.viewCount)],
        limit: 50,
      })
    },

    searchPlayersByAlias(query: string) {
      return db
        .select({ brawlhallaId: playerAlias.brawlhallaId })
        .from(playerAlias)
        .where(ilike(playerAlias.key, `${query.toLowerCase()}%`))
        .limit(50)
    },

    getPlayersByIds(ids: number[]) {
      return db.query.player.findMany({
        where: inArray(player.brawlhallaId, ids),
        orderBy: [desc(player.rating)],
        limit: 20,
      })
    },

    async batchUpsertPlayers(
      rankings: Array<{
        brawlhalla_id: number
        name: string
        rating: number
        peak_rating: number
        tier: string
        games: number
        wins: number
        region: string
        best_legend: number
        best_legend_games: number
        best_legend_wins: number
      }>,
    ) {
      const now = new Date()
      const rows = rankings.map((r) => ({
        brawlhallaId: r.brawlhalla_id,
        name: r.name ?? '',
        region: r.region ?? null,
        rating: r.rating ?? 0,
        peakRating: r.peak_rating ?? 0,
        tier: r.tier ?? null,
        rankedGames: r.games ?? 0,
        rankedWins: r.wins ?? 0,
        bestLegend: r.best_legend ?? 0,
        bestLegendGames: r.best_legend_games ?? 0,
        bestLegendWins: r.best_legend_wins ?? 0,
      }))

      if (rows.length > 0) {
        await db
          .insert(player)
          .values(rows as (typeof player.$inferInsert)[])
          .onConflictDoUpdate({
            target: player.brawlhallaId,
            set: {
              name: sql`excluded.name`,
              region: sql`excluded.region`,
              rating: sql`excluded.rating`,
              peakRating: sql`excluded.peak_rating`,
              tier: sql`excluded.tier`,
              rankedGames: sql`excluded.ranked_games`,
              rankedWins: sql`excluded.ranked_wins`,
              bestLegend: sql`excluded.best_legend`,
              bestLegendGames: sql`excluded.best_legend_games`,
              bestLegendWins: sql`excluded.best_legend_wins`,
              valhallanConfirmedAt: sql`CASE WHEN excluded.tier LIKE 'Valhallan%' THEN NOW() ELSE player.valhallan_confirmed_at END`,
              lastUpdated: now,
            },
          })
      }
    },

    getExistingPlayerNames(ids: number[]) {
      return db.query.player
        .findMany({
          where: inArray(player.brawlhallaId, ids),
          columns: { brawlhallaId: true, name: true },
        })
        .then((rows) => new Map(rows.map((p) => [p.brawlhallaId, p.name])))
    },

    batchInsertAliases(aliases: Array<{ brawlhallaId: number; key: string; value: string }>) {
      if (aliases.length === 0) return Promise.resolve()
      return db
        .insert(playerAlias)
        .values(aliases)
        .onConflictDoNothing()
        .then(() => {})
    },

    batchUpsertPlaceholderPlayers(
      rows: Array<{ brawlhallaId: number; name: string; region: string | null; rating: number }>,
    ) {
      if (rows.length === 0) return Promise.resolve()
      return db
        .insert(player)
        .values(rows as (typeof player.$inferInsert)[])
        .onConflictDoNothing()
        .then(() => {})
    },

    async batchUpsertTeams(
      teamRows: Array<{
        brawlhallaId: number
        brawlhallaIdOne: number
        brawlhallaIdTwo: number
        teamName: string
        rating: number
        peakRating: number
        tier: string
        wins: number
        games: number
        region: string | null
        globalRank: number | null
      }>,
    ) {
      if (teamRows.length === 0) return
      await db
        .insert(playerRankedTeam)
        .values(teamRows)
        .onConflictDoUpdate({
          target: [playerRankedTeam.brawlhallaId, playerRankedTeam.brawlhallaIdOne, playerRankedTeam.brawlhallaIdTwo],
          set: {
            teamName: sql`excluded.team_name`,
            rating: sql`excluded.rating`,
            peakRating: sql`excluded.peak_rating`,
            tier: sql`excluded.tier`,
            wins: sql`excluded.wins`,
            games: sql`excluded.games`,
            region: sql`excluded.region`,
            globalRank: sql`excluded.global_rank`,
            valhallanConfirmedAt: sql`CASE WHEN excluded.tier LIKE 'Valhallan%' THEN NOW() ELSE player_ranked_team.valhallan_confirmed_at END`,
          },
        })
    },

    transaction: db.transaction.bind(db),
  }
}

export type PlayerRepo = ReturnType<typeof createPlayerRepo>
