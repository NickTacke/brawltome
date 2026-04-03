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
import { desc, eq, sql } from 'drizzle-orm'

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
      await db.delete(playerRankedLegend).where(eq(playerRankedLegend.brawlhallaId, brawlhallaId))
      if (legends.length > 0) {
        await db.insert(playerRankedLegend).values(
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
      await db.delete(playerRankedTeam).where(eq(playerRankedTeam.brawlhallaId, brawlhallaId))
      if (teams.length > 0) {
        await db.insert(playerRankedTeam).values(teams.map((t) => ({ brawlhallaId, ...t })))
      }
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

    async replaceStatsLegends(brawlhallaId: number, legends: Array<typeof playerStatsLegend.$inferInsert>) {
      await db.delete(playerStatsLegend).where(eq(playerStatsLegend.brawlhallaId, brawlhallaId))
      if (legends.length > 0) {
        await db.insert(playerStatsLegend).values(legends)
      }
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
      await db.delete(playerWeaponStat).where(eq(playerWeaponStat.brawlhallaId, brawlhallaId))
      if (weapons.length > 0) {
        await db.insert(playerWeaponStat).values(weapons.map((w) => ({ brawlhallaId, ...w })))
      }
    },

    async upsertClan(
      brawlhallaId: number,
      data: {
        clan_name: string
        clan_id: number
        clan_xp: string
        clan_lifetime_xp: string
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

    transaction: db.transaction.bind(db),
  }
}

export type PlayerRepo = ReturnType<typeof createPlayerRepo>
