import postgres from 'postgres'

export type ProfileViewDemand = { brawlhallaId: number; viewDays: number; lastViewedOn: string }

// Per-player, per-day view counts: the demand signal for background refreshes. Only the player and the day are kept,
// never who viewed.
export function createPostgresProfileViews(connectionString: string) {
  const client = postgres(connectionString)

  return {
    // Counts only players with a name source behind their reference (the same sources the reference read uses), so
    // made-up IDs never become background refresh demand. New players arrive through the admitted interactive refresh.
    async recordView(brawlhallaId: number): Promise<void> {
      if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1 || brawlhallaId > 2_147_483_647) return
      await client`
        INSERT INTO players.profile_view_days (day, brawlhalla_id, views)
        SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date, ${brawlhallaId}, 1
        WHERE EXISTS (
          SELECT 1 FROM players.ranked_profiles
          WHERE brawlhalla_id = ${brawlhallaId} AND last_success_at IS NOT NULL AND player_name IS NOT NULL
          UNION ALL
          SELECT 1 FROM players.career_profiles
          WHERE brawlhalla_id = ${brawlhallaId} AND last_success_at IS NOT NULL AND player_name IS NOT NULL
          UNION ALL
          SELECT 1 FROM players.leaderboard_name_observations WHERE brawlhalla_id = ${brawlhallaId}
          UNION ALL
          SELECT 1 FROM players.legacy_discovery_profiles WHERE brawlhalla_id = ${brawlhallaId}
          UNION ALL
          SELECT 1 FROM players.legacy_profile_discovery WHERE brawlhalla_id = ${brawlhallaId}
        )
        ON CONFLICT (day, brawlhalla_id) DO UPDATE SET views = profile_view_days.views + 1
      `
    },

    // Players viewed within the window, with the number of distinct days they were viewed on.
    async viewDemand(input: { days: number }): Promise<ProfileViewDemand[]> {
      const rows = await client<{ brawlhalla_id: number; view_days: number; last_viewed_on: string }[]>`
        SELECT brawlhalla_id, count(*)::integer AS view_days, max(day)::text AS last_viewed_on
        FROM players.profile_view_days
        WHERE day > (clock_timestamp() AT TIME ZONE 'UTC')::date - ${input.days}::integer
        GROUP BY brawlhalla_id
      `
      return rows.map((row) => ({
        brawlhallaId: row.brawlhalla_id,
        viewDays: row.view_days,
        lastViewedOn: row.last_viewed_on,
      }))
    },

    async trim(input: { keepDays: number }): Promise<number> {
      const deleted = await client`
        DELETE FROM players.profile_view_days
        WHERE day <= (clock_timestamp() AT TIME ZONE 'UTC')::date - ${input.keepDays}::integer
      `
      return deleted.count
    },

    close: () => client.end(),
  }
}

export type PostgresProfileViews = ReturnType<typeof createPostgresProfileViews>
