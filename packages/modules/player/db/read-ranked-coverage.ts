import type { Database } from '@brawltome/foundation'
import type { RankedCoverageCandidate } from '../ranked/coverage-policy'

type CandidateRow = { brawlhalla_id: number; rating: number; last_success_at: Date | null }

/** Players on the 1v1 boards at or above a rating, with when their V0 ranked profile last refreshed. */
export async function readRankedCoverageCandidates(
  database: Database,
  input: { minimumRating: number; observedSince: Date },
): Promise<RankedCoverageCandidate[]> {
  const rows = await database.sql<CandidateRow[]>`
    SELECT observation.brawlhalla_id, observation.rating, profile.last_success_at
    FROM players.leaderboard_ranked_observations observation
    LEFT JOIN players.ranked_profiles profile USING (brawlhalla_id)
    WHERE observation.rating >= ${input.minimumRating}
      AND observation.observed_at >= ${input.observedSince}
  `

  return rows.map((row) => ({
    brawlhallaId: row.brawlhalla_id,
    rating: row.rating,
    lastSuccessAt: row.last_success_at,
  }))
}

/** When the player's V0 ranked profile last refreshed, by any path; null when it never did. */
export async function readLastRankedSuccess(database: Database, brawlhallaId: number): Promise<Date | null> {
  const [row] = await database.sql<{ last_success_at: Date | null }[]>`
    SELECT last_success_at FROM players.ranked_profiles WHERE brawlhalla_id = ${brawlhallaId}
  `

  return row?.last_success_at ?? null
}

/** The coverage reads bound to one database. */
export function createPostgresRankedCoverage(database: Database) {
  return {
    candidates: (input: { minimumRating: number; observedSince: Date }) =>
      readRankedCoverageCandidates(database, input),

    lastRankedSuccess: (brawlhallaId: number) => readLastRankedSuccess(database, brawlhallaId),
  }
}

export type PostgresRankedCoverage = ReturnType<typeof createPostgresRankedCoverage>
