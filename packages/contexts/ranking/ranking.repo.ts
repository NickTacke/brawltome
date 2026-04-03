import type { Database } from '@brawltome/database'
import { blacklist, clan, player, playerAlias, playerRankedTeam } from '@brawltome/database'
import { and, asc, desc, gt, ilike, inArray, not, sql } from 'drizzle-orm'

export function createRankingRepo(db: Database) {
  return {
    getBlacklistedIds() {
      return db
        .select({ brawlhallaId: blacklist.brawlhallaId })
        .from(blacklist)
        .then((rows) => new Set(rows.map((b) => b.brawlhallaId)))
    },

    // 1v1 leaderboard query from leaderboard.service.ts
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
      const regionFilter = opts.region !== 'all' ? sql`${player.region} = ${opts.region}` : undefined

      return db
        .select()
        .from(player)
        .where(
          and(
            gt(player.rating, 0),
            regionFilter,
            opts.blacklistSet.size > 0 ? not(inArray(player.brawlhallaId, [...opts.blacklistSet])) : undefined,
          ),
        )
        .orderBy(orderFn(sortColumn))
        .limit(opts.pageSize)
        .offset(opts.offset)
    },

    // 2v2 leaderboard query from leaderboard.service.ts
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
      const regionFilter = opts.region !== 'all' ? sql`${playerRankedTeam.region} = ${opts.region}` : undefined

      return db
        .select()
        .from(playerRankedTeam)
        .where(and(gt(playerRankedTeam.rating, 0), gt(playerRankedTeam.games, 0), regionFilter))
        .orderBy(orderFn(sortColumn))
        .limit(opts.pageSize * 2) // Fetch extra for dedup
        .offset(opts.offset)
    },

    // Get player names for 2v2 enrichment
    getPlayerNames(playerIds: number[]) {
      if (playerIds.length === 0) return Promise.resolve(new Map<number, string>())
      return db
        .select({ brawlhallaId: player.brawlhallaId, name: player.name })
        .from(player)
        .where(inArray(player.brawlhallaId, playerIds))
        .then((rows) => new Map(rows.map((p) => [p.brawlhallaId, p.name])))
    },

    // Search players by name - from search.service.ts
    searchPlayersByName(query: string, blacklistSet: Set<number>) {
      return db.query.player.findMany({
        where: and(
          sql`(${player.name} ILIKE ${`${query}%`} OR ${player.name} ILIKE ${`% | ${query}%`})`,
          blacklistSet.size > 0 ? not(inArray(player.brawlhallaId, [...blacklistSet])) : undefined,
        ),
        orderBy: [desc(player.rating), desc(player.viewCount)],
        limit: 50,
      })
    },

    // Search aliases - from search.service.ts
    searchPlayersByAlias(query: string) {
      return db
        .select({ brawlhallaId: playerAlias.brawlhallaId })
        .from(playerAlias)
        .where(ilike(playerAlias.key, `${query.toLowerCase()}%`))
        .limit(50)
    },

    // Get players by IDs - for alias search results
    getPlayersByIds(ids: number[]) {
      return db.query.player.findMany({
        where: inArray(player.brawlhallaId, ids),
        orderBy: [desc(player.rating)],
        limit: 20,
      })
    },

    // Search clans - from search.service.ts
    searchClans(query: string) {
      return db.query.clan.findMany({
        where: ilike(clan.clanName, `${query}%`),
        orderBy: [desc(clan.clanXp)],
        limit: 5,
      })
    },

    // Janitor: batch upsert players from rankings
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

    // Janitor: get existing player names for alias tracking
    getExistingPlayerNames(ids: number[]) {
      return db.query.player
        .findMany({
          where: inArray(player.brawlhallaId, ids),
          columns: { brawlhallaId: true, name: true },
        })
        .then((rows) => new Map(rows.map((p) => [p.brawlhallaId, p.name])))
    },

    // Janitor: batch insert aliases
    batchInsertAliases(aliases: Array<{ brawlhallaId: number; key: string; value: string }>) {
      if (aliases.length === 0) return Promise.resolve()
      return db
        .insert(playerAlias)
        .values(aliases)
        .onConflictDoNothing()
        .then(() => {})
    },

    // Janitor: batch upsert placeholder players for 2v2 team members
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

    // Janitor: batch upsert ranked teams
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
  }
}

export type RankingRepo = ReturnType<typeof createRankingRepo>
