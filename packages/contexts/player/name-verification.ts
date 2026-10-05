import postgres from 'postgres'

type Sql = ReturnType<typeof postgres>

export type NameVerificationCandidate = { brawlhallaId: number; playerName: string; v0Name: string }
export type NameVerificationBacklog = { rename_signal: number; demand: number; other: number }

export type NameVerificationPolicy = {
  // Defaults to the database clock.
  now?: Date
  perWindow: number
  windowMs: number
  // Minimum gap between checks of one (player, leaderboard name) pair.
  dedupeMs: number
  // A name V0 confirmed stale is rechecked after this long while the leaderboard keeps showing it.
  staleRecheckMs: number
  // Pinned and Primary Players.
  demandIds?: readonly number[]
}

export type NameVerificationOutcome = 'renamed' | 'confirmed_stale' | 'failed'
export type NameVerificationPreparation =
  | { state: 'needed' }
  | { state: 'obsolete' }
  | { state: 'resolved'; outcome: Exclude<NameVerificationOutcome, 'failed'> }

type CandidateRow = {
  brawlhalla_id: number
  player_name: string
  v0_name: string
  // Text keeps microsecond precision for the round trip into the claim.
  v0_observed_at: string
  observed_at: string
  rename_signal: number
  demand: number
  other: number
}

const emptyBacklog: NameVerificationBacklog = { rename_signal: 0, demand: 0, other: 0 }
// Unspent claims outlive any queue delay; failed checks retry after 1h, 6h, then daily.
const pendingHoldMs = 24 * 60 * 60 * 1000

// Candidates are computed from current state, so a normal V0 refresh (visit, monitoring) settles them for free.
async function selectCandidates(
  sql: Sql,
  policy: Omit<NameVerificationPolicy, 'perWindow' | 'windowMs'>,
  limit: number,
): Promise<CandidateRow[]> {
  const demandIds = [...(policy.demandIds ?? [])]
  return sql<CandidateRow[]>`
    WITH clock AS (SELECT coalesce(${policy.now ?? null}::timestamptz, clock_timestamp()) AS now),
    observed AS (
      SELECT observation.brawlhalla_id, observation.player_name, observation.observed_at,
             observation.previous_player_name, live.player_name AS v0_name, live.observed_at AS v0_observed_at,
             ranked.global_rank, ranked.rating, attempt.outcome, attempt.checked_at, attempt.failures,
             attempt.observed_at AS attempt_observed_at, clock.now
      FROM players.leaderboard_name_observations observation
      LEFT JOIN players.ranked_profiles ranked ON ranked.brawlhalla_id = observation.brawlhalla_id
      -- The canonical live V0 name: newest of ranked and live career, ties keep career. Either alone qualifies.
      CROSS JOIN LATERAL (
        SELECT candidate.player_name, candidate.observed_at
        FROM (
          SELECT player_name, last_success_at AS observed_at, 0 AS priority FROM players.career_profiles
          WHERE brawlhalla_id = observation.brawlhalla_id AND last_success_at IS NOT NULL
            AND player_name IS NOT NULL AND snapshot_source <> 'legacy-v2'
          UNION ALL
          SELECT player_name, last_success_at, 1 FROM players.ranked_profiles
          WHERE brawlhalla_id = observation.brawlhalla_id AND last_success_at IS NOT NULL
            AND player_name IS NOT NULL
        ) candidate
        ORDER BY candidate.observed_at DESC, candidate.priority
        LIMIT 1
      ) live
      LEFT JOIN players.name_verifications attempt
        ON attempt.brawlhalla_id = observation.brawlhalla_id AND attempt.player_name = observation.player_name
      CROSS JOIN clock
      WHERE NOT players.names_match(observation.player_name, live.player_name)
    ),
    pending AS (
      SELECT *,
        CASE
          WHEN previous_player_name IS NOT NULL AND players.names_match(previous_player_name, v0_name) THEN 0
          WHEN brawlhalla_id = ANY(${demandIds}::integer[]) THEN 1
          ELSE 2
        END AS tier
      FROM observed
      WHERE (observed_at > v0_observed_at
          OR (outcome = 'confirmed_stale' AND checked_at <= now - ${policy.staleRecheckMs} * interval '1 millisecond'))
        AND NOT coalesce(CASE outcome
          WHEN 'pending' THEN checked_at > now - ${pendingHoldMs} * interval '1 millisecond'
          WHEN 'failed' THEN checked_at > now - CASE
            WHEN failures <= 1 THEN interval '1 hour' WHEN failures = 2 THEN interval '6 hours' ELSE interval '1 day'
          END
          WHEN 'confirmed_stale' THEN checked_at > now - ${policy.dedupeMs} * interval '1 millisecond'
            OR (attempt_observed_at = observed_at
              AND checked_at > now - ${policy.staleRecheckMs} * interval '1 millisecond')
          ELSE checked_at > now - ${policy.dedupeMs} * interval '1 millisecond'
        END, false)
    )
    SELECT brawlhalla_id, player_name, v0_name, v0_observed_at::text, observed_at::text,
           count(*) FILTER (WHERE tier = 0) OVER ()::integer AS rename_signal,
           count(*) FILTER (WHERE tier = 1) OVER ()::integer AS demand,
           count(*) FILTER (WHERE tier = 2) OVER ()::integer AS other
    FROM pending
    -- Within a tier, names V1 saw change rank above mismatches present since the first observation.
    ORDER BY tier, previous_player_name IS NULL, global_rank ASC NULLS LAST, rating DESC NULLS LAST,
             v0_observed_at, brawlhalla_id
    LIMIT ${limit}
  `
}

function backlogOf(rows: CandidateRow[]): NameVerificationBacklog {
  const [row] = rows
  return row ? { rename_signal: row.rename_signal, demand: row.demand, other: row.other } : { ...emptyBacklog }
}

const toCandidate = (row: CandidateRow): NameVerificationCandidate => ({
  brawlhallaId: row.brawlhalla_id,
  playerName: row.player_name,
  v0Name: row.v0_name,
})

export function createPostgresPlayerNameVerifications(connectionString: string) {
  const client = postgres(connectionString)

  // Renamed when V0 moved off the name it had at claim time, confirmed stale when it kept it.
  async function settle(
    sql: Sql,
    brawlhallaId: number,
    playerName: string,
    spent: boolean,
  ): Promise<NameVerificationOutcome> {
    const [row] = await sql<{ outcome: NameVerificationOutcome }[]>`
      WITH current AS (
        SELECT (
          SELECT player_name FROM players.ranked_profiles
          WHERE brawlhalla_id = ${brawlhallaId} AND last_success_at IS NOT NULL
        ) AS player_name
      )
      UPDATE players.name_verifications attempt
      SET spent = ${spent},
          outcome = CASE
            WHEN current.player_name IS NULL THEN 'failed'
            WHEN players.names_match(current.player_name, attempt.v0_name) THEN 'confirmed_stale'
            ELSE 'renamed'
          END,
          failures = CASE WHEN current.player_name IS NULL THEN attempt.failures + 1 ELSE 0 END
      FROM current
      WHERE attempt.brawlhalla_id = ${brawlhallaId} AND attempt.player_name = ${playerName}
      RETURNING attempt.outcome
    `
    return row?.outcome ?? 'failed'
  }

  return {
    async candidates(
      policy: Omit<NameVerificationPolicy, 'perWindow' | 'windowMs'> & { limit?: number },
    ): Promise<{ backlog: NameVerificationBacklog; candidates: NameVerificationCandidate[] }> {
      const rows = await selectCandidates(client, policy, policy.limit ?? 1_000)
      return { backlog: backlogOf(rows), candidates: rows.map(toCandidate) }
    },

    // Atomically reserves up to the remaining per-window budget; spent checks and still-pending claims count toward the window.
    async claim(
      policy: NameVerificationPolicy,
    ): Promise<{ backlog: NameVerificationBacklog; usedInWindow: number; claimed: NameVerificationCandidate[] }> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        await sql`SELECT pg_advisory_xact_lock(hashtext('players.name_verifications'))`
        const now = policy.now ?? null
        const [window] = await sql<{ used: number }[]>`
          SELECT count(*)::integer AS used FROM players.name_verifications
          WHERE spent AND (
            checked_at > coalesce(${now}::timestamptz, clock_timestamp()) - ${policy.windowMs} * interval '1 millisecond'
            -- A claim whose source call has not happened yet will still spend budget, however long the queue delays it.
            OR (outcome = 'pending'
              AND checked_at > coalesce(${now}::timestamptz, clock_timestamp()) - ${pendingHoldMs} * interval '1 millisecond')
          )
        `
        const remaining = Math.max(0, policy.perWindow - window.used)
        const rows = await selectCandidates(sql, policy, Math.max(1, remaining))
        const claimed = remaining > 0 ? rows : []
        if (claimed.length > 0) {
          await sql`
            INSERT INTO players.name_verifications AS attempt
              (brawlhalla_id, player_name, v0_name, v0_observed_at, observed_at, checked_at, outcome, spent)
            SELECT brawlhalla_id, player_name, v0_name, v0_observed_at::timestamptz, observed_at::timestamptz,
                   coalesce(${now}::timestamptz, clock_timestamp()), 'pending', true
            FROM unnest(
              ${claimed.map((row) => row.brawlhalla_id)}::integer[],
              ${claimed.map((row) => row.player_name)}::text[],
              ${claimed.map((row) => row.v0_name)}::text[],
              ${claimed.map((row) => row.v0_observed_at)}::text[],
              ${claimed.map((row) => row.observed_at)}::text[]
            ) AS claimed(brawlhalla_id, player_name, v0_name, v0_observed_at, observed_at)
            ON CONFLICT (brawlhalla_id, player_name) DO UPDATE SET
              v0_name = EXCLUDED.v0_name, v0_observed_at = EXCLUDED.v0_observed_at,
              observed_at = EXCLUDED.observed_at, checked_at = EXCLUDED.checked_at,
              outcome = 'pending', spent = true
          `
        }
        return { backlog: backlogOf(rows), usedInWindow: window.used, claimed: claimed.map(toCandidate) }
      })
    },

    // Returns an unspent claim: no source call was made, so it neither counts nor dedupes.
    async release(brawlhallaId: number, playerName: string): Promise<void> {
      await client`
        DELETE FROM players.name_verifications
        WHERE brawlhalla_id = ${brawlhallaId} AND player_name = ${playerName} AND outcome = 'pending'
      `
    },

    // Re-checked right before the call: another V0 refresh or a newer leaderboard name may have settled it.
    async prepare(brawlhallaId: number, playerName: string): Promise<NameVerificationPreparation> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        const [row] = await sql<{ observed: boolean; refreshed: boolean }[]>`
          SELECT observation.player_name IS NOT DISTINCT FROM attempt.player_name AS observed,
                 coalesce(live.observed_at > attempt.v0_observed_at, false) AS refreshed
          FROM players.name_verifications attempt
          LEFT JOIN players.leaderboard_name_observations observation USING (brawlhalla_id)
          LEFT JOIN LATERAL (
            SELECT max(last_success_at) AS observed_at
            FROM (
              SELECT last_success_at FROM players.ranked_profiles WHERE brawlhalla_id = attempt.brawlhalla_id
              UNION ALL
              SELECT last_success_at FROM players.career_profiles
              WHERE brawlhalla_id = attempt.brawlhalla_id AND snapshot_source <> 'legacy-v2'
            ) observations
          ) live ON true
          WHERE attempt.brawlhalla_id = ${brawlhallaId} AND attempt.player_name = ${playerName}
            AND attempt.outcome = 'pending'
          FOR UPDATE OF attempt
        `
        if (!row?.observed) {
          await sql`
            DELETE FROM players.name_verifications
            WHERE brawlhalla_id = ${brawlhallaId} AND player_name = ${playerName} AND outcome = 'pending'
          `
          return { state: 'obsolete' as const }
        }
        if (!row.refreshed) return { state: 'needed' as const }
        const outcome = await settle(sql, brawlhallaId, playerName, false)
        if (outcome === 'failed') return { state: 'obsolete' as const }
        return { state: 'resolved' as const, outcome }
      })
    },

    recordChecked: (brawlhallaId: number, playerName: string) => settle(client, brawlhallaId, playerName, true),

    async recordFailed(brawlhallaId: number, playerName: string): Promise<NameVerificationOutcome> {
      await client`
        UPDATE players.name_verifications
        SET outcome = 'failed', spent = true, failures = failures + 1
        WHERE brawlhalla_id = ${brawlhallaId} AND player_name = ${playerName}
      `
      return 'failed'
    },

    close: () => client.end(),
  }
}

export type PostgresPlayerNameVerifications = ReturnType<typeof createPostgresPlayerNameVerifications>
