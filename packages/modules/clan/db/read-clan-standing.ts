import type { Database } from '@brawltome/foundation'

type ClanStanding = {
  guildPointsRank: number | null
  lifetimeXpRank: number
}

/**
 * A stored clan's rank on guild points and on lifetime xp, or null when its profile was never fetched. A rank is one
 * more than the clans strictly above, so tied clans share it. One statement, so both ranks come from one snapshot.
 */
export async function readClanStanding(database: Database, clanId: number): Promise<ClanStanding | null> {
  // a comparison with null matches no row, so without the case a clan with no guild points would rank first
  const [standing] = await database.sql<ClanStanding[]>`
    SELECT
      CASE WHEN clan.guild_points IS NOT NULL THEN (
        SELECT count(*)::integer + 1 FROM clans.profiles AS rival WHERE rival.guild_points > clan.guild_points
      ) END AS "guildPointsRank",
      (
        SELECT count(*)::integer + 1 FROM clans.profiles AS rival WHERE rival.clan_lifetime_xp > clan.clan_lifetime_xp
      ) AS "lifetimeXpRank"
    FROM clans.profiles AS clan
    WHERE clan.clan_id = ${clanId}
  `

  return standing ?? null
}
