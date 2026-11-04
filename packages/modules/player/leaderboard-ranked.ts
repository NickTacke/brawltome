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

// Changed-only, newer-only upsert of per-player standings. Unchanged rows keep their first observation time: V1
// serves cached rows, so an unchanged row says nothing newer than a V0 refresh taken in between.
async function upsertStandings(
  sql: Sql,
  table: ReturnType<Sql>,
  observations: readonly LeaderboardRankedObservation[],
  observedAt: Date,
): Promise<{ brawlhalla_id: number }[]> {
  return sql<{ brawlhalla_id: number }[]>`
    INSERT INTO ${table} AS current
      (brawlhalla_id, region, rating, peak_rating, tier, wins, games, observed_at)
    SELECT brawlhalla_id, region, rating, peak_rating, NULLIF(tier, ''), wins, games, ${observedAt}
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
}

export type LeaderboardTeamObservation = {
  brawlhallaIdOne: number
  brawlhallaIdTwo: number
  region: string
  rating: number
  peakRating: number
  tier: string | null
  wins: number
  games: number
}

// One observation per unordered pair, stored with the lower id first.
function teamObservations(teams: readonly LeaderboardTeamObservation[]): LeaderboardTeamObservation[] {
  const byPair = new Map<string, LeaderboardTeamObservation>()
  for (const team of teams) {
    const one = Math.min(team.brawlhallaIdOne, team.brawlhallaIdTwo)
    const two = Math.max(team.brawlhallaIdOne, team.brawlhallaIdTwo)
    if (
      !isInt32(one, 1) ||
      !isInt32(two, 1) ||
      one === two ||
      !team.region ||
      !isInt32(team.rating, 0) ||
      !isInt32(team.peakRating, 0) ||
      !isInt32(team.wins, 0) ||
      !isInt32(team.games, team.wins)
    ) {
      continue
    }
    const key = `${one}:${two}`
    if (!byPair.has(key)) byPair.set(key, { ...team, brawlhallaIdOne: one, brawlhallaIdTwo: two })
  }
  return [...byPair.values()].sort(
    (left, right) => left.brawlhallaIdOne - right.brawlhallaIdOne || left.brawlhallaIdTwo - right.brawlhallaIdTwo,
  )
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
        const changed = await upsertStandings(
          sql,
          sql`players.leaderboard_ranked_observations`,
          observations,
          input.observedAt,
        )
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

    // Solo 2v2 standings for profiles. Search shows 1v1 only, so nothing is republished.
    async applyLeaderboardSoloQueue(input: {
      observedAt: Date
      players: readonly LeaderboardRankedObservation[]
    }): Promise<{ changed: number }> {
      const observations = observationsById(input.players)
      if (observations.length === 0) return { changed: 0 }
      const changed = await upsertStandings(
        client,
        client`players.leaderboard_solo_queue_observations`,
        observations,
        input.observedAt,
      )
      return { changed: changed.length }
    },

    // Fixed 2v2 team standings for profiles, changed-only and newer-only like the player standings.
    async applyLeaderboardTeams(input: {
      observedAt: Date
      teams: readonly LeaderboardTeamObservation[]
    }): Promise<{ changed: number }> {
      const teams = teamObservations(input.teams)
      if (teams.length === 0) return { changed: 0 }
      const changed = await client<{ brawlhalla_id_one: number }[]>`
        INSERT INTO players.leaderboard_team_observations AS current
          (brawlhalla_id_one, brawlhalla_id_two, region, rating, peak_rating, tier, wins, games, observed_at)
        SELECT one, two, region, rating, peak_rating, NULLIF(tier, ''), wins, games, ${input.observedAt}
        FROM unnest(
          ${teams.map(({ brawlhallaIdOne }) => brawlhallaIdOne)}::integer[],
          ${teams.map(({ brawlhallaIdTwo }) => brawlhallaIdTwo)}::integer[],
          ${teams.map(({ region }) => region)}::text[],
          ${teams.map(({ rating }) => rating)}::integer[],
          ${teams.map(({ peakRating }) => peakRating)}::integer[],
          ${teams.map(({ tier }) => tier ?? '')}::text[],
          ${teams.map(({ wins }) => wins)}::integer[],
          ${teams.map(({ games }) => games)}::integer[]
        ) AS input(one, two, region, rating, peak_rating, tier, wins, games)
        ORDER BY one, two
        ON CONFLICT (brawlhalla_id_one, brawlhalla_id_two) DO UPDATE SET
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
        RETURNING brawlhalla_id_one
      `
      return { changed: changed.length }
    },

    close: () => client.end(),
  }
}

export type PostgresLeaderboardRanked = ReturnType<typeof createPostgresLeaderboardRanked>
