import postgres from 'postgres'

type Sql = ReturnType<typeof postgres>

export type LeaderboardRankedObservation = {
  brawlhallaId: number
  region: string
  rating: number
  peakRating: number
  tier: string | null
  wins: number
  games: number
}

export type LeaderboardRankedStanding = LeaderboardRankedObservation & { observedAt: Date }

const INT32_MAX = 2_147_483_647

function isInt32(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= INT32_MAX
}

function observationsById(players: readonly LeaderboardRankedObservation[]): LeaderboardRankedObservation[] {
  const observations = new Map<number, LeaderboardRankedObservation>()
  for (const player of players) {
    if (
      !isInt32(player.brawlhallaId, 1) ||
      !player.region ||
      !isInt32(player.rating, 0) ||
      !isInt32(player.peakRating, 0) ||
      !isInt32(player.wins, 0) ||
      !isInt32(player.games, player.wins)
    ) {
      continue
    }
    if (!observations.has(player.brawlhallaId)) observations.set(player.brawlhallaId, player)
  }
  return [...observations.values()].sort((left, right) => left.brawlhallaId - right.brawlhallaId)
}

export function createPostgresLeaderboardRanked(connectionString: string) {
  const client = postgres(connectionString)

  return {
    // Records the 1v1 standings a published leaderboard observed, so players nobody visits still show current
    // ratings. Only changed values are written and keep their first observation time: V1 serves cached rows, so an
    // unchanged row says nothing newer than a V0 refresh taken in between.
    async applyLeaderboardRanked(input: {
      observedAt: Date
      players: readonly LeaderboardRankedObservation[]
    }): Promise<{ changed: number }> {
      const observations = observationsById(input.players)
      if (observations.length === 0) return { changed: 0 }

      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        const changed = await sql<{ brawlhalla_id: number }[]>`
          INSERT INTO players.leaderboard_ranked_observations AS current
            (brawlhalla_id, region, rating, peak_rating, tier, wins, games, observed_at)
          SELECT brawlhalla_id, region, rating, peak_rating, NULLIF(tier, ''), wins, games, ${input.observedAt}
          FROM unnest(
            ${observations.map(({ brawlhallaId }) => brawlhallaId)}::integer[],
            ${observations.map(({ region }) => region)}::text[],
            ${observations.map(({ rating }) => rating)}::integer[],
            ${observations.map(({ peakRating }) => peakRating)}::integer[],
            ${observations.map(({ tier }) => tier ?? '')}::text[],
            ${observations.map(({ wins }) => wins)}::integer[],
            ${observations.map(({ games }) => games)}::integer[]
          ) AS input(brawlhalla_id, region, rating, peak_rating, tier, wins, games)
          ORDER BY brawlhalla_id
          ON CONFLICT (brawlhalla_id) DO UPDATE SET
            region = EXCLUDED.region,
            rating = EXCLUDED.rating,
            peak_rating = EXCLUDED.peak_rating,
            tier = EXCLUDED.tier,
            wins = EXCLUDED.wins,
            games = EXCLUDED.games,
            observed_at = EXCLUDED.observed_at
          WHERE current.observed_at < EXCLUDED.observed_at
            AND (current.region, current.rating, current.peak_rating, current.tier, current.wins, current.games)
              IS DISTINCT FROM
                (EXCLUDED.region, EXCLUDED.rating, EXCLUDED.peak_rating, EXCLUDED.tier, EXCLUDED.wins, EXCLUDED.games)
          RETURNING brawlhalla_id
        `
        if (changed.length === 0) return { changed: 0 }

        // Search shows rating and region, so republish these identities to discovery.
        await sql`
          WITH version AS (
            UPDATE players.discovery_state
            SET source_version = source_version + 1
            WHERE singleton
            RETURNING source_version
          )
          INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
          SELECT changed.brawlhalla_id, version.source_version
          FROM unnest(${changed.map(({ brawlhalla_id }) => brawlhalla_id)}::integer[]) AS changed(brawlhalla_id)
          CROSS JOIN version
        `
        return { changed: changed.length }
      })
    },

    // The player's latest 1v1 leaderboard standing, for profiles that have no V0 ranked snapshot yet.
    async standingById(brawlhallaId: number): Promise<LeaderboardRankedStanding | null> {
      const [row] = await client<
        {
          region: string
          rating: number
          peak_rating: number
          tier: string | null
          wins: number
          games: number
          observed_at: Date
        }[]
      >`
        SELECT region, rating, peak_rating, tier, wins, games, observed_at
        FROM players.leaderboard_ranked_observations
        WHERE brawlhalla_id = ${brawlhallaId}
      `
      return row
        ? {
            brawlhallaId,
            region: row.region,
            rating: row.rating,
            peakRating: row.peak_rating,
            tier: row.tier,
            wins: row.wins,
            games: row.games,
            observedAt: row.observed_at,
          }
        : null
    },

    close: () => client.end(),
  }
}

export type PostgresLeaderboardRanked = ReturnType<typeof createPostgresLeaderboardRanked>
