import type { Database } from '@brawltome/foundation'

export type RankedClanRow = {
  rank: number | null
  clanId: number
  clanName: string
  guildPoints: string | null
  lifetimeXp: string
  memberCount: number
}

export type RankedClansPage = { totalRows: number; rows: RankedClanRow[] }

type ListRankedClansInput = { page: number; pageSize: number }

/**
 * One page of the stored clans, most guild points first and ties by id. The rank is taken over every clan before the
 * page is cut, so a tied clan shares its rank as in readClanStanding. The total and the page come from one snapshot.
 */
export async function listRankedClans(database: Database, input: ListRankedClansInput): Promise<RankedClansPage> {
  const offset = (input.page - 1) * input.pageSize

  return database.sql.begin('isolation level repeatable read read only', async (transaction) => {
    const [total] = await transaction<{ totalRows: number }[]>`
      SELECT count(*)::integer AS "totalRows" FROM clans.profiles
    `

    // the members are counted after the page is cut, so a page never counts the roster of every clan
    const rows = await transaction<RankedClanRow[]>`
      WITH ranked AS (
        SELECT
          clan.clan_id,
          clan.clan_name,
          clan.guild_points,
          clan.clan_lifetime_xp,
          rank() OVER (ORDER BY clan.guild_points DESC NULLS LAST)::integer AS points_rank
        FROM clans.profiles AS clan
        ORDER BY clan.guild_points DESC NULLS LAST, clan.clan_id
        LIMIT ${input.pageSize} OFFSET ${offset}
      )
      SELECT
        CASE WHEN ranked.guild_points IS NOT NULL THEN ranked.points_rank END AS rank,
        ranked.clan_id AS "clanId",
        ranked.clan_name AS "clanName",
        ranked.guild_points::text AS "guildPoints",
        ranked.clan_lifetime_xp::text AS "lifetimeXp",
        (SELECT count(*)::integer FROM clans.members AS member WHERE member.clan_id = ranked.clan_id) AS "memberCount"
      FROM ranked
      ORDER BY ranked.guild_points DESC NULLS LAST, ranked.clan_id
    `

    return { totalRows: total?.totalRows ?? 0, rows: [...rows] }
  })
}
