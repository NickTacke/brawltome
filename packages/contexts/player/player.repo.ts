import type { Database } from '@brawltome/database'
import {
  player,
  playerAlias,
  playerClan,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
} from '@brawltome/database'
import { getLegendById } from '@brawltome/shared'
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm'
import { getEffectiveBestLegend, getEffectiveBestLegendsBatch } from './queries/get-effective-best-legend'

export type Team2v2Row = {
  brawlhalla_id_one: number
  brawlhalla_id_two: number
  team_name: string
  rating: number
  peak_rating: number
  tier: string
  wins: number
  games: number
  region: string
  synced_at: Date
  rank: number
}

export function createPlayerRepo(db: Database) {
  return {
    async findById(brawlhallaId: number) {
      const p = await db.query.player.findFirst({
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

    // Called only after lifetime stats corroborate that ranked 404 means unranked this season.
    // Keep bestLegend as the profile avatar identity and stamp freshness to stop re-enqueueing.
    clearRanked(brawlhallaId: number) {
      return db
        .update(player)
        .set({
          rating: 0,
          peakRating: 0,
          tier: null,
          rankedGames: 0,
          rankedWins: 0,
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

    async get1v1LeaderboardSweep(opts: {
      region: string
      pageSize: number
      offset: number
      freshSince: Date
    }) {
      const ranked = db
        .select({
          brawlhallaId: player.brawlhallaId,
          name: player.name,
          region: player.region,
          rating: player.rating,
          peakRating: player.peakRating,
          tier: player.tier,
          rankedGames: player.rankedGames,
          rankedWins: player.rankedWins,
          bestLegend: player.bestLegend,
          rank: sql<number>`row_number() over (order by ${player.rating} desc, ${player.rankedWins} desc)`.as('rank'),
        })
        .from(player)
        .where(
          and(
            gt(player.syncedAt1v1, opts.freshSince),
            opts.region !== 'all' ? eq(player.region, opts.region) : undefined,
          ),
        )
        .as('ranked')
      return db.select().from(ranked).orderBy(asc(ranked.rank)).limit(opts.pageSize).offset(opts.offset)
    },

    async get3v3LeaderboardSweep(opts: {
      region: string
      pageSize: number
      offset: number
      freshSince: Date
    }) {
      const ranked = db
        .select({
          brawlhallaId: player.brawlhallaId,
          name: player.name,
          region: player.region,
          rating: player.rating3v3,
          peakRating: player.peakRating3v3,
          tier: player.tier3v3,
          wins: player.wins3v3,
          losses: player.losses3v3,
          // 3v3 has no stored `games` column — derive from wins+losses so the
          // frontend's winrate calc has a non-zero denominator.
          games: sql<number>`${player.wins3v3} + ${player.losses3v3}`.as('games'),
          rank: sql<number>`row_number() over (order by ${player.rating3v3} desc, ${player.wins3v3} desc)`.as('rank'),
        })
        .from(player)
        .where(
          and(
            gt(player.syncedAt3v3, opts.freshSince),
            opts.region !== 'all' ? eq(player.region, opts.region) : undefined,
          ),
        )
        .as('ranked')
      return db.select().from(ranked).orderBy(asc(ranked.rank)).limit(opts.pageSize).offset(opts.offset)
    },

    async get2v2LeaderboardSweep(opts: {
      region: string
      pageSize: number
      offset: number
      freshSince: Date
    }): Promise<Team2v2Row[]> {
      // Dedupe by canonical (least, greatest) pair, then compute rank by rating/wins.
      // Two-row-per-team owner pattern means each team can show up twice — DISTINCT ON keeps one.
      const result = await db.execute(sql`
        WITH dedup AS (
          SELECT DISTINCT ON (LEAST(brawlhalla_id_one, brawlhalla_id_two), GREATEST(brawlhalla_id_one, brawlhalla_id_two))
            brawlhalla_id_one, brawlhalla_id_two, team_name, rating, peak_rating, tier, wins, games, region, synced_at
          FROM player_ranked_team
          WHERE synced_at > ${opts.freshSince.toISOString()}::timestamp
            AND brawlhalla_id_two != 0 AND brawlhalla_id_one != 0
            ${opts.region !== 'all' ? sql`AND region = ${opts.region}` : sql``}
          ORDER BY LEAST(brawlhalla_id_one, brawlhalla_id_two), GREATEST(brawlhalla_id_one, brawlhalla_id_two), rating DESC
        )
        SELECT *, ROW_NUMBER() OVER (ORDER BY rating DESC, wins DESC) AS rank
        FROM dedup
        ORDER BY rank
        LIMIT ${opts.pageSize}
        OFFSET ${opts.offset}
      `)
      return (Array.isArray(result) ? result : ((result as { rows?: Team2v2Row[] }).rows ?? [])) as Team2v2Row[]
    },

    async getSolo2v2LeaderboardSweep(opts: {
      region: string
      pageSize: number
      offset: number
      freshSince: Date
    }) {
      const ranked = db
        .select({
          brawlhallaId: playerRankedTeam.brawlhallaId,
          brawlhallaIdOne: playerRankedTeam.brawlhallaIdOne,
          brawlhallaIdTwo: playerRankedTeam.brawlhallaIdTwo,
          region: playerRankedTeam.region,
          rating: playerRankedTeam.rating,
          peakRating: playerRankedTeam.peakRating,
          tier: playerRankedTeam.tier,
          wins: playerRankedTeam.wins,
          games: playerRankedTeam.games,
          rank: sql<number>`row_number() over (order by ${playerRankedTeam.rating} desc, ${playerRankedTeam.wins} desc)`.as(
            'rank',
          ),
        })
        .from(playerRankedTeam)
        .where(
          and(
            gt(playerRankedTeam.syncedAt, opts.freshSince),
            eq(playerRankedTeam.brawlhallaIdTwo, 0),
            opts.region !== 'all' ? eq(playerRankedTeam.region, opts.region) : undefined,
          ),
        )
        .as('ranked')
      return db.select().from(ranked).orderBy(asc(ranked.rank)).limit(opts.pageSize).offset(opts.offset)
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

    searchPlayersByName(query: string) {
      return db.query.player.findMany({
        where: or(ilike(player.name, `${query}%`), ilike(player.name, `% | ${query}%`)),
        orderBy: [desc(player.rating), desc(player.viewCount)],
        limit: 50,
      })
    },

    searchPlayersByAlias(query: string) {
      return db
        .select({ brawlhallaId: playerAlias.brawlhallaId, alias: playerAlias.value })
        .from(playerAlias)
        .where(ilike(playerAlias.key, `${query.toLowerCase()}%`))
        .orderBy(asc(playerAlias.brawlhallaId), desc(playerAlias.createdAt))
        .limit(50)
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

    async sweepUpsert1v1(
      rows: Array<{
        brawlhallaId: number
        name: string
        region: string
        rating: number
        peakRating: number
        tier: string | null
        wins: number
        losses: number
      }>,
    ) {
      if (rows.length === 0) return
      // Sort by primary key so concurrent batches acquire row locks in the same order
      // (postgres locks rows in the VALUES list order). Eliminates deadlock cycles when
      // multiple sweep workers upsert overlapping IDs.
      rows.sort((a, b) => a.brawlhallaId - b.brawlhallaId)
      const ids = rows.map((r) => r.brawlhallaId)
      const existing = await db
        .select({ brawlhallaId: player.brawlhallaId, name: player.name })
        .from(player)
        .where(inArray(player.brawlhallaId, ids))
      const existingNames = new Map(existing.map((e) => [e.brawlhallaId, e.name]))
      const aliases: Array<{ brawlhallaId: number; key: string; value: string }> = []
      for (const r of rows) {
        const old = existingNames.get(r.brawlhallaId)
        if (old && old !== r.name) aliases.push({ brawlhallaId: r.brawlhallaId, key: old.toLowerCase(), value: old })
      }
      if (aliases.length > 0) {
        aliases.sort((a, b) => a.brawlhallaId - b.brawlhallaId)
        await db.insert(playerAlias).values(aliases).onConflictDoNothing()
      }

      const now = new Date()
      await db
        .insert(player)
        .values(
          rows.map((r) => ({
            brawlhallaId: r.brawlhallaId,
            name: r.name,
            region: r.region,
            rating: r.rating,
            peakRating: r.peakRating,
            tier: r.tier,
            rankedGames: r.wins + r.losses,
            rankedWins: r.wins,
            syncedAt1v1: now,
          })),
        )
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
            syncedAt1v1: sql`excluded.synced_at_1v1`,
            valhallanConfirmedAt: sql`CASE WHEN excluded.tier LIKE 'Valhallan%' THEN NOW() ELSE player.valhallan_confirmed_at END`,
            lastUpdated: now,
          },
        })
    },

    async sweepUpsert3v3(
      rows: Array<{
        brawlhallaId: number
        name: string
        region: string
        rating: number
        peakRating: number
        tier: string | null
        wins: number
        losses: number
      }>,
    ) {
      if (rows.length === 0) return
      // Sort by PK to keep concurrent batch lock-acquisition order consistent.
      rows.sort((a, b) => a.brawlhallaId - b.brawlhallaId)
      const now = new Date()
      await db
        .insert(player)
        .values(
          rows.map((r) => ({
            brawlhallaId: r.brawlhallaId,
            name: r.name,
            region: r.region,
            rating3v3: r.rating,
            peakRating3v3: r.peakRating,
            tier3v3: r.tier,
            wins3v3: r.wins,
            losses3v3: r.losses,
            syncedAt3v3: now,
          })),
        )
        .onConflictDoUpdate({
          target: player.brawlhallaId,
          set: {
            name: sql`excluded.name`,
            region: sql`excluded.region`,
            rating3v3: sql`excluded.rating_3v3`,
            peakRating3v3: sql`excluded.peak_rating_3v3`,
            tier3v3: sql`excluded.tier_3v3`,
            wins3v3: sql`excluded.wins_3v3`,
            losses3v3: sql`excluded.losses_3v3`,
            syncedAt3v3: sql`excluded.synced_at_3v3`,
            lastUpdated: now,
          },
        })
    },

    async sweepUpsert2v2(
      teams: Array<{
        brawlhallaIdOne: number
        brawlhallaIdTwo: number
        playerOneName: string
        playerTwoName: string
        teamName: string
        rating: number
        peakRating: number
        tier: string
        wins: number
        losses: number
        region: string
      }>,
    ) {
      if (teams.length === 0) return
      const now = new Date()
      const rows: Array<typeof playerRankedTeam.$inferInsert> = []
      const idToName = new Map<number, string>()
      for (const t of teams) {
        const ownerIds =
          t.brawlhallaIdOne === t.brawlhallaIdTwo ? [t.brawlhallaIdOne] : [t.brawlhallaIdOne, t.brawlhallaIdTwo]
        const valhallanConfirmedAt = t.tier.startsWith('Valhallan') ? now : null
        for (const ownerId of ownerIds) {
          rows.push({
            brawlhallaId: ownerId,
            brawlhallaIdOne: t.brawlhallaIdOne,
            brawlhallaIdTwo: t.brawlhallaIdTwo,
            teamName: t.teamName,
            rating: t.rating,
            peakRating: t.peakRating,
            tier: t.tier,
            wins: t.wins,
            games: t.wins + t.losses,
            region: t.region,
            valhallanConfirmedAt,
          })
        }
        // Last write wins per id (within this batch). Endpoint returns one username per row,
        // so collisions on the same id pick whichever team appeared last on this page.
        idToName.set(t.brawlhallaIdOne, t.playerOneName)
        idToName.set(t.brawlhallaIdTwo, t.playerTwoName)
      }
      const placeholders = [...idToName].map(([id, name]) => ({ brawlhallaId: id, name }))
      // Sort by PK so concurrent sweep workers acquire row locks in identical order,
      // avoiding postgres deadlocks on the player table.
      placeholders.sort((a, b) => a.brawlhallaId - b.brawlhallaId)
      // Only overwrite the player's name when the existing row is still a `Player {id}`
      // placeholder. The 2v2 endpoint can return stale usernames (cached from team creation),
      // so refreshing every name would clobber fresh names written by the 1v1 sweep or by
      // /player/{id}/ranked enrichment.
      await db
        .insert(player)
        .values(placeholders as (typeof player.$inferInsert)[])
        .onConflictDoUpdate({
          target: player.brawlhallaId,
          set: {
            name: sql`CASE WHEN player.name = ('Player ' || player.brawlhalla_id::text) THEN excluded.name ELSE player.name END`,
          },
        })

      // Sort by composite PK (brawlhallaId, brawlhallaIdOne, brawlhallaIdTwo, region) so
      // concurrent sweep workers lock rows in the same order across batches.
      rows.sort((a, b) => {
        if (a.brawlhallaId !== b.brawlhallaId) return a.brawlhallaId - b.brawlhallaId
        if (a.brawlhallaIdOne !== b.brawlhallaIdOne) return a.brawlhallaIdOne - b.brawlhallaIdOne
        if (a.brawlhallaIdTwo !== b.brawlhallaIdTwo) return a.brawlhallaIdTwo - b.brawlhallaIdTwo
        return a.region < b.region ? -1 : a.region > b.region ? 1 : 0
      })
      await db
        .insert(playerRankedTeam)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            playerRankedTeam.brawlhallaId,
            playerRankedTeam.brawlhallaIdOne,
            playerRankedTeam.brawlhallaIdTwo,
            playerRankedTeam.region,
          ],
          set: {
            teamName: sql`excluded.team_name`,
            rating: sql`excluded.rating`,
            peakRating: sql`excluded.peak_rating`,
            tier: sql`excluded.tier`,
            wins: sql`excluded.wins`,
            games: sql`excluded.games`,
            syncedAt: sql`excluded.synced_at`,
            valhallanConfirmedAt: sql`CASE WHEN excluded.tier LIKE 'Valhallan%' THEN NOW() ELSE player_ranked_team.valhallan_confirmed_at END`,
          },
        })
    },

    async sweepUpsertSolo2v2(
      rows: Array<{
        brawlhallaId: number
        name: string
        teamName: string
        rating: number
        peakRating: number
        tier: string
        wins: number
        losses: number
        region: string
      }>,
    ) {
      if (rows.length === 0) return
      // Sort by brawlhallaId so concurrent sweep workers acquire row locks consistently.
      // For solo entries brawlhallaIdOne == brawlhallaId and brawlhallaIdTwo == 0, so
      // brawlhallaId alone uniquely orders rows for both player and playerRankedTeam writes.
      rows.sort((a, b) => a.brawlhallaId - b.brawlhallaId)
      const placeholders = rows.map((r) => ({ brawlhallaId: r.brawlhallaId, name: r.name }))
      // Solo 2v2 entries provide a fresh username per row; refresh the player.name on conflict
      // so existing players (incl. legacy `Player {id}` placeholders from the 2v2 path) get
      // their real names without waiting for the 1v1 sweep.
      await db
        .insert(player)
        .values(placeholders as (typeof player.$inferInsert)[])
        .onConflictDoUpdate({
          target: player.brawlhallaId,
          set: {
            name: sql`excluded.name`,
          },
        })

      const now = new Date()
      await db
        .insert(playerRankedTeam)
        .values(
          rows.map((r) => ({
            brawlhallaId: r.brawlhallaId,
            brawlhallaIdOne: r.brawlhallaId,
            brawlhallaIdTwo: 0,
            teamName: r.teamName,
            rating: r.rating,
            peakRating: r.peakRating,
            tier: r.tier,
            wins: r.wins,
            games: r.wins + r.losses,
            region: r.region,
            valhallanConfirmedAt: r.tier.startsWith('Valhallan') ? now : null,
          })),
        )
        .onConflictDoUpdate({
          target: [
            playerRankedTeam.brawlhallaId,
            playerRankedTeam.brawlhallaIdOne,
            playerRankedTeam.brawlhallaIdTwo,
            playerRankedTeam.region,
          ],
          set: {
            teamName: sql`excluded.team_name`,
            rating: sql`excluded.rating`,
            peakRating: sql`excluded.peak_rating`,
            tier: sql`excluded.tier`,
            wins: sql`excluded.wins`,
            games: sql`excluded.games`,
            syncedAt: sql`excluded.synced_at`,
            valhallanConfirmedAt: sql`CASE WHEN excluded.tier LIKE 'Valhallan%' THEN NOW() ELSE player_ranked_team.valhallan_confirmed_at END`,
          },
        })
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
