import postgres from 'postgres'

export function createPostgresPlayerFreshness(connectionString: string) {
  const client = postgres(connectionString)

  return {
    // When each player's full V0 profile was last refreshed: the older of the ranked and career refreshes, or null if
    // either never succeeded (a legacy-v2 career was never fetched from V0).
    async lastRefreshedById(brawlhallaIds: readonly number[]): Promise<Map<number, Date | null>> {
      const ids = [...new Set(brawlhallaIds)]
      const refreshed = new Map<number, Date | null>(ids.map((brawlhallaId) => [brawlhallaId, null]))
      if (ids.length === 0) return refreshed
      const rows = await client<{ brawlhalla_id: number; refreshed_at: Date | null }[]>`
        SELECT requested.brawlhalla_id,
               CASE
                 WHEN ranked.last_success_at IS NULL OR career.last_success_at IS NULL
                   OR career.snapshot_source = 'legacy-v2' THEN NULL
                 ELSE LEAST(ranked.last_success_at, career.last_success_at)
               END AS refreshed_at
        FROM unnest(${ids}::integer[]) AS requested(brawlhalla_id)
        LEFT JOIN players.ranked_profiles ranked USING (brawlhalla_id)
        LEFT JOIN players.career_profiles career USING (brawlhalla_id)
      `
      for (const row of rows) refreshed.set(row.brawlhalla_id, row.refreshed_at)
      return refreshed
    },

    close: () => client.end(),
  }
}

export type PostgresPlayerFreshness = ReturnType<typeof createPostgresPlayerFreshness>
