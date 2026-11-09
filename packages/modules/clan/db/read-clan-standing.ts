import type { Database } from '@brawltome/foundation'

type ClanStanding = {
  guildPointsRank: number | null
  lifetimeXpRank: number
  lastWeekPoints: string | null
  lastWeekRank: number | null
}

/**
 * A stored clan's rank on guild points, on lifetime xp and on the guild points it earned last week, or null when its
 * profile was never fetched. A rank is one more than the clans strictly above, so tied clans share it. One statement,
 * so every rank comes from one snapshot.
 *
 * Last week is the latest finished weekly snapshot minus the one seven days before it. A clan missing either of
 * them, or whose points went down, which is a reset rather than a week of play, has no figure and no rank.
 */
export async function readClanStanding(database: Database, clanId: number): Promise<ClanStanding | null> {
  // a comparison with null matches no row, so without the case a clan with no guild points would rank first
  const [standing] = await database.sql<ClanStanding[]>`
    WITH latest_week AS (
      SELECT week_starting FROM clans.weekly_snapshot_runs
      WHERE completed_at IS NOT NULL
      ORDER BY week_starting DESC
      LIMIT 1
    ),
    last_week AS (
      SELECT latest.clan_id, latest.guild_points - earlier.guild_points AS points
      FROM latest_week
      JOIN clans.weekly_snapshots AS latest ON latest.week_starting = latest_week.week_starting
      JOIN clans.weekly_snapshots AS earlier
        ON earlier.clan_id = latest.clan_id AND earlier.week_starting = latest_week.week_starting - 7
      WHERE latest.guild_points >= earlier.guild_points
    )
    SELECT
      CASE WHEN clan.guild_points IS NOT NULL THEN (
        SELECT count(*)::integer + 1 FROM clans.profiles AS rival WHERE rival.guild_points > clan.guild_points
      ) END AS "guildPointsRank",
      (
        SELECT count(*)::integer + 1 FROM clans.profiles AS rival WHERE rival.clan_lifetime_xp > clan.clan_lifetime_xp
      ) AS "lifetimeXpRank",
      week.points::text AS "lastWeekPoints",
      CASE WHEN week.points IS NOT NULL THEN (
        SELECT count(*)::integer + 1 FROM last_week AS rival WHERE rival.points > week.points
      ) END AS "lastWeekRank"
    FROM clans.profiles AS clan
    LEFT JOIN last_week AS week ON week.clan_id = clan.clan_id
    WHERE clan.clan_id = ${clanId}
  `

  return standing ?? null
}
