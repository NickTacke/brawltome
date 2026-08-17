import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import type {
  LeaderboardGenerationCandidate,
  LeaderboardScope,
  LeaderboardView,
  PlayerValhallanEvidence,
  PlayerValhallanQueries,
  PublicationResult,
  PublishedLeaderboardIdentity,
  RankingPublicationAuthorization,
  RankingQueries,
  RecentActivityView,
} from './leaderboard'
import { leaderboardModeFromOperationKind } from './leaderboard'
import {
  type LeaderboardMode,
  type RegionalLeaderboardScope,
  leaderboardModes,
  regionalLeaderboardScopes,
} from './v1-leaderboard-source'

type SnapshotRow = {
  snapshot_id: string
  generation_id: string
  mode: LeaderboardMode
  scope: LeaderboardScope
  observed_at: Date
  published_at: Date
  expected_next_publication_at: Date
  provenance: Record<string, unknown>
  row_count: number
  latest_failure_at: Date | null
} & (
  | {
      page_depth: number
      source: 'brawlhalla-v1-ranked-leaderboard'
      source_contract_version: 1 | 2
    }
  | {
      page_depth: null
      source: 'v2-legacy'
      source_contract_version: 1
    }
)

type StoredIdentityRow = {
  identity_kind: PublishedLeaderboardIdentity['type']
  player_one_id: number
  player_one_name: string
  player_two_id: number | null
  player_two_name: string | null
}

type StandingRow = StoredIdentityRow & {
  standing: number
  source_rank: number
  region: RegionalLeaderboardScope
  rating: number
  peak_rating: number | null
  wins: number
  losses: number
  tier: string | null
}

type ActivityIntervalRow = Extract<SnapshotRow, { source: 'brawlhalla-v1-ranked-leaderboard' }> & {
  schedule_window_at: Date
  previous_snapshot_id: string
  previous_observed_at: Date
  previous_expected_next_publication_at: Date
}

type ActivityStandingRow = StoredIdentityRow & {
  standing: number
  region: RegionalLeaderboardScope
  rating: number
  rating_delta: number
  wins_delta: number
  losses_delta: number
  games_delta: number
  total_count: number
}

function boundedPagination(page: number, pageSize = 20) {
  return {
    page: Math.max(1, Math.min(Number.isSafeInteger(page) ? page : 1, 500)),
    pageSize: Math.max(1, Math.min(Number.isSafeInteger(pageSize) ? pageSize : 20, 100)),
  }
}

function validateScope(scope: string): asserts scope is LeaderboardScope {
  if (scope !== 'all' && !(regionalLeaderboardScopes as readonly string[]).includes(scope)) {
    throw new Error(`unsupported leaderboard scope ${scope}`)
  }
}

function validateMode(mode: string): asserts mode is LeaderboardMode {
  if (!(leaderboardModes as readonly string[]).includes(mode)) throw new Error(`unsupported leaderboard mode ${mode}`)
}

function storedIdentity(identity: PublishedLeaderboardIdentity) {
  if (identity.type === 'fixed-two-vs-two-team') {
    return {
      identity_kind: identity.type,
      player_one_id: identity.players[0].brawlhallaId,
      player_one_name: identity.players[0].name,
      player_two_id: identity.players[1].brawlhallaId,
      player_two_name: identity.players[1].name,
    }
  }
  return {
    identity_kind: identity.type,
    player_one_id: identity.player.brawlhallaId,
    player_one_name: identity.player.name,
    player_two_id: null,
    player_two_name: null,
  }
}

function publishedIdentity(row: StoredIdentityRow): PublishedLeaderboardIdentity {
  const first = { brawlhallaId: row.player_one_id, name: row.player_one_name }
  if (row.identity_kind === 'fixed-two-vs-two-team') {
    if (row.player_two_id === null || row.player_two_name === null) throw new Error('stored fixed team is incomplete')
    return {
      type: row.identity_kind,
      players: [first, { brawlhallaId: row.player_two_id, name: row.player_two_name }],
    }
  }
  if (row.player_two_id !== null || row.player_two_name !== null)
    throw new Error('stored player identity has a teammate')
  if (row.identity_kind === 'one-vs-one-player') return { type: row.identity_kind, player: first }
  if (row.identity_kind === 'solo-two-vs-two-player') return { type: row.identity_kind, player: first }
  if (row.identity_kind === 'three-vs-three-player') return { type: row.identity_kind, player: first }
  throw new Error('stored leaderboard identity is unsupported')
}

function publishedProvenance(
  snapshot: SnapshotRow,
): Extract<LeaderboardView, { status: 'fresh' | 'stale' }>['provenance'] {
  if (snapshot.source === 'brawlhalla-v1-ranked-leaderboard') {
    if (snapshot.page_depth === null) throw new Error('stored V1 leaderboard provenance has no page depth')
    let pageDepth = snapshot.page_depth
    const scopePageDepths = snapshot.provenance.scopePageDepths
    if (scopePageDepths !== undefined) {
      if (typeof scopePageDepths !== 'object' || scopePageDepths === null || Array.isArray(scopePageDepths)) {
        throw new Error('stored V1 leaderboard scope depths are invalid')
      }
      const scopePageDepth = (scopePageDepths as Record<string, unknown>)[snapshot.scope]
      if (!Number.isSafeInteger(scopePageDepth) || (scopePageDepth as number) < 1) {
        throw new Error('stored V1 leaderboard scope depth is invalid')
      }
      pageDepth = scopePageDepth as number
    }
    return {
      source: snapshot.source,
      contractVersion: snapshot.source_contract_version,
      pageDepth,
    }
  }
  const sourceChecksum = snapshot.provenance.sourceChecksum
  const importedAt = snapshot.provenance.importedAt
  if (
    typeof sourceChecksum !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(sourceChecksum) ||
    typeof importedAt !== 'string' ||
    snapshot.provenance.completeness !== 'frozen-repository-rows'
  ) {
    throw new Error('stored legacy leaderboard provenance is invalid')
  }
  return {
    source: snapshot.source,
    contractVersion: snapshot.source_contract_version,
    sourceChecksum,
    importedAt,
    completeness: 'frozen-repository-rows',
  }
}

export function createPostgresRanking(connectionString: string) {
  const client = postgres(connectionString)

  async function lockAuthorizedOperation(
    sql: typeof client,
    authorization: RankingPublicationAuthorization,
  ): Promise<boolean> {
    const [result] = await sql<{ active: boolean }[]>`
      SELECT refresh_operations.lock_active_leaderboard_lease(
        ${authorization.operationId},
        ${authorization.operationKey},
        ${authorization.operationKind},
        ${authorization.leaseOwner},
        ${authorization.leaseToken}
      ) AS active
    `
    return result?.active === true
  }

  async function recordOperationEffect(
    sql: typeof client,
    authorization: RankingPublicationAuthorization,
  ): Promise<'applied' | 'already-applied' | 'effect-conflict' | 'lease-lost'> {
    const [result] = await sql<{ result: 'applied' | 'already-applied' | 'effect-conflict' | 'lease-lost' }[]>`
      SELECT refresh_operations.record_leaderboard_effect(
        ${authorization.operationId},
        ${authorization.operationKey},
        ${authorization.operationKind},
        ${authorization.leaseOwner},
        ${authorization.leaseToken}
      ) AS result
    `
    return result?.result ?? 'lease-lost'
  }

  async function playerValhallanEvidenceById(brawlhallaId: number): Promise<PlayerValhallanEvidence | null> {
    if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1) throw new Error('brawlhallaId must be positive')
    const rows = await client<
      Array<{
        mode: '1v1' | '2v2' | 'solo2v2'
        player_one_id: number
        player_two_id: number | null
      }>
    >`
      WITH latest_generation AS (
        SELECT DISTINCT ON (mode) id, mode
        FROM rankings.generations
        WHERE finalized
          AND source = 'brawlhalla-v1-ranked-leaderboard'
          AND mode IN ('1v1', '2v2', 'solo2v2')
        ORDER BY mode, schedule_window_at DESC, id DESC
      )
      SELECT row.mode, row.player_one_id, row.player_two_id
      FROM latest_generation generation
      JOIN rankings.snapshots snapshot
        ON snapshot.generation_id = generation.id
        AND snapshot.mode = generation.mode
        AND snapshot.scope = 'all'
      JOIN rankings.snapshot_rows row
        ON row.snapshot_id = snapshot.id
        AND row.mode = snapshot.mode
      WHERE row.tier LIKE 'Valhallan%'
        AND (row.player_one_id = ${brawlhallaId} OR row.player_two_id = ${brawlhallaId})
    `
    if (rows.length === 0) return null
    return {
      oneVsOne: rows.some((row) => row.mode === '1v1'),
      fixedTwoVsTwoTeams: rows
        .filter(
          (row): row is typeof row & { mode: '2v2'; player_two_id: number } =>
            row.mode === '2v2' && row.player_two_id !== null,
        )
        .map((row) => ({ brawlhallaIdOne: row.player_one_id, brawlhallaIdTwo: row.player_two_id })),
      soloTwoVsTwo: rows.some((row) => row.mode === 'solo2v2'),
    }
  }

  async function getLeaderboard(input: {
    mode: LeaderboardMode
    region: LeaderboardScope
    page: number
    pageSize?: number
    snapshotId?: string
    now?: Date
  }): Promise<LeaderboardView> {
    validateMode(input.mode)
    validateScope(input.region)
    const { page, pageSize } = boundedPagination(input.page, input.pageSize)
    const [snapshot] = await client<SnapshotRow[]>`
      SELECT snapshot.id AS snapshot_id, snapshot.generation_id, snapshot.mode, snapshot.scope,
             generation.observed_at, generation.published_at, generation.expected_next_publication_at,
             generation.page_depth, generation.source, generation.source_contract_version,
             generation.provenance, snapshot.row_count,
             (
               SELECT max(failure.checked_at)
               FROM rankings.collection_failures failure
               WHERE failure.mode = snapshot.mode
                 AND (
                   failure.scope = 'all'
                   OR snapshot.scope = 'all'
                   OR failure.scope = snapshot.scope
                 )
                 AND failure.schedule_window_at >= generation.schedule_window_at
             ) AS latest_failure_at
      FROM rankings.snapshots snapshot
      JOIN rankings.generations generation
        ON generation.id = snapshot.generation_id AND generation.mode = snapshot.mode
      WHERE generation.finalized
        AND snapshot.mode = ${input.mode}
        AND snapshot.scope = ${input.region}
        AND (${input.snapshotId ?? null}::uuid IS NULL OR snapshot.id = ${input.snapshotId ?? null})
      ORDER BY generation.schedule_window_at DESC, generation.id DESC
      LIMIT 1
    `
    if (!snapshot) {
      return {
        status: 'unavailable',
        reason: input.snapshotId ? 'snapshot_not_found' : 'not_yet_published',
        mode: input.mode,
        page,
        pageSize,
      }
    }

    const offset = (page - 1) * pageSize
    const entries = await client<StandingRow[]>`
      SELECT standing, source_rank, identity_kind, player_one_id, player_one_name,
             player_two_id, player_two_name, region, rating, peak_rating, wins, losses, tier
      FROM rankings.snapshot_rows
      WHERE snapshot_id = ${snapshot.snapshot_id} AND mode = ${snapshot.mode}
      ORDER BY ordinal
      OFFSET ${offset}
      LIMIT ${pageSize}
    `
    const now = input.now ?? new Date()
    const stale =
      now >= snapshot.expected_next_publication_at ||
      (snapshot.latest_failure_at !== null && snapshot.latest_failure_at > snapshot.published_at)
    return {
      status: stale ? 'stale' : 'fresh',
      snapshotId: snapshot.snapshot_id,
      generationId: snapshot.generation_id,
      mode: snapshot.mode,
      region: snapshot.scope,
      observedAt: snapshot.observed_at.toISOString(),
      publishedAt: snapshot.published_at.toISOString(),
      expectedNextPublicationAt: snapshot.expected_next_publication_at.toISOString(),
      provenance: publishedProvenance(snapshot),
      page,
      pageSize,
      hasMore: offset + entries.length < snapshot.row_count,
      totalRows: snapshot.row_count,
      entries: entries.map((entry) => ({
        standing: entry.standing,
        sourceRank: entry.source_rank,
        identity: publishedIdentity(entry),
        region: entry.region,
        rating: entry.rating,
        peakRating: entry.peak_rating,
        wins: entry.wins,
        losses: entry.losses,
        games: entry.wins + entry.losses,
        tier: entry.tier,
      })),
    }
  }

  async function getRecentActivity(input: {
    mode: LeaderboardMode
    region: LeaderboardScope
    page: number
    pageSize?: number
    snapshotId?: string
    now?: Date
  }): Promise<RecentActivityView> {
    validateMode(input.mode)
    validateScope(input.region)
    const { page, pageSize } = boundedPagination(input.page, input.pageSize)
    const [interval] = await client<ActivityIntervalRow[]>`
      WITH current_generation AS (
        SELECT generation.*
        FROM rankings.generations generation
        WHERE generation.finalized
          AND generation.source = 'brawlhalla-v1-ranked-leaderboard'
          AND generation.mode = ${input.mode}
          AND (
            ${input.snapshotId ?? null}::uuid IS NULL
            OR EXISTS (
              SELECT 1
              FROM rankings.snapshots pinned_snapshot
              WHERE pinned_snapshot.id = ${input.snapshotId ?? null}
                AND pinned_snapshot.generation_id = generation.id
                AND pinned_snapshot.mode = generation.mode
                AND pinned_snapshot.scope = ${input.region}
            )
          )
        ORDER BY generation.schedule_window_at DESC, generation.id DESC
        LIMIT 1
      ), current_endpoint AS (
        SELECT snapshot.id AS snapshot_id, snapshot.generation_id, snapshot.mode, snapshot.scope,
               generation.observed_at, generation.schedule_window_at, generation.published_at,
               generation.expected_next_publication_at, generation.page_depth, generation.source,
               generation.source_contract_version, generation.provenance, snapshot.row_count
        FROM current_generation generation
        JOIN rankings.snapshots snapshot
          ON snapshot.generation_id = generation.id
         AND snapshot.mode = generation.mode
         AND snapshot.scope = ${input.region}
         AND (${input.snapshotId ?? null}::uuid IS NULL OR snapshot.id = ${input.snapshotId ?? null})
      )
      SELECT current_endpoint.*,
             previous_snapshot.id AS previous_snapshot_id,
             previous_generation.observed_at AS previous_observed_at,
             previous_generation.expected_next_publication_at AS previous_expected_next_publication_at,
             (
               SELECT max(failure.checked_at)
               FROM rankings.collection_failures failure
               WHERE failure.mode = current_endpoint.mode
                 AND (
                   failure.scope = 'all'
                   OR current_endpoint.scope = 'all'
                   OR failure.scope = current_endpoint.scope
                 )
                 AND failure.schedule_window_at >= current_endpoint.schedule_window_at
             ) AS latest_failure_at
      FROM current_endpoint
      JOIN LATERAL (
        SELECT generation.id AS generation_id, generation.observed_at,
               generation.expected_next_publication_at
        FROM rankings.generations generation
        WHERE generation.finalized
          AND generation.source = 'brawlhalla-v1-ranked-leaderboard'
          AND generation.mode = current_endpoint.mode
          AND (
            generation.schedule_window_at < current_endpoint.schedule_window_at
            OR (
              generation.schedule_window_at = current_endpoint.schedule_window_at
              AND generation.id < current_endpoint.generation_id
            )
          )
        ORDER BY generation.schedule_window_at DESC, generation.id DESC
        LIMIT 1
      ) previous_generation ON true
      JOIN rankings.snapshots previous_snapshot
        ON previous_snapshot.generation_id = previous_generation.generation_id
       AND previous_snapshot.mode = current_endpoint.mode
       AND previous_snapshot.scope = current_endpoint.scope
    `
    if (!interval) {
      return {
        status: 'unavailable',
        reason: 'not_enough_history',
        mode: input.mode,
        region: input.region,
        page,
        pageSize,
      }
    }
    if (interval.previous_expected_next_publication_at.getTime() !== interval.schedule_window_at.getTime()) {
      return {
        status: 'unavailable',
        reason: 'scan_gap',
        mode: input.mode,
        region: input.region,
        page,
        pageSize,
      }
    }

    const offset = (page - 1) * pageSize
    const entries = await client<ActivityStandingRow[]>`
      SELECT current.standing, current.identity_kind, current.player_one_id, current.player_one_name,
             current.player_two_id, current.player_two_name, current.region, current.rating,
             current.rating - previous.rating AS rating_delta,
             current.wins - previous.wins AS wins_delta,
             current.losses - previous.losses AS losses_delta,
             (current.wins + current.losses) - (previous.wins + previous.losses) AS games_delta,
             (count(*) OVER ())::integer AS total_count
      FROM rankings.snapshot_rows current
      JOIN rankings.snapshot_rows previous
        ON previous.snapshot_id = ${interval.previous_snapshot_id}
       AND previous.identity_key = current.identity_key
      WHERE current.snapshot_id = ${interval.snapshot_id}
        AND current.wins >= previous.wins
        AND current.losses >= previous.losses
        AND current.wins + current.losses > previous.wins + previous.losses
      ORDER BY current.rating DESC,
               ((current.wins + current.losses) - (previous.wins + previous.losses)) DESC,
               current.identity_key ASC
      OFFSET ${offset}
      LIMIT ${pageSize}
    `
    let totalRows = entries[0]?.total_count ?? 0
    if (entries.length === 0 && offset > 0) {
      const [count] = await client<{ total_count: number }[]>`
        SELECT count(*)::integer AS total_count
        FROM rankings.snapshot_rows current
        JOIN rankings.snapshot_rows previous
          ON previous.snapshot_id = ${interval.previous_snapshot_id}
         AND previous.identity_key = current.identity_key
        WHERE current.snapshot_id = ${interval.snapshot_id}
          AND current.wins >= previous.wins
          AND current.losses >= previous.losses
          AND current.wins + current.losses > previous.wins + previous.losses
      `
      totalRows = count?.total_count ?? 0
    }
    const now = input.now ?? new Date()
    const stale =
      now >= interval.expected_next_publication_at ||
      (interval.latest_failure_at !== null && interval.latest_failure_at > interval.published_at)
    const provenance = publishedProvenance(interval)
    if (provenance.source !== 'brawlhalla-v1-ranked-leaderboard') {
      throw new Error('recent activity requires official leaderboard provenance')
    }
    return {
      status: stale ? 'stale' : 'fresh',
      mode: interval.mode,
      region: interval.scope,
      currentSnapshotId: interval.snapshot_id,
      previousObservedAt: interval.previous_observed_at.toISOString(),
      currentObservedAt: interval.observed_at.toISOString(),
      publishedAt: interval.published_at.toISOString(),
      expectedNextPublicationAt: interval.expected_next_publication_at.toISOString(),
      provenance,
      page,
      pageSize,
      hasMore: offset + entries.length < totalRows,
      totalRows,
      entries: entries.map((entry) => ({
        standing: entry.standing,
        identity: publishedIdentity(entry),
        region: entry.region,
        rating: entry.rating,
        ratingDelta: entry.rating_delta,
        winsDelta: entry.wins_delta,
        lossesDelta: entry.losses_delta,
        gamesDelta: entry.games_delta,
      })),
    }
  }

  const queries: RankingQueries & PlayerValhallanQueries = {
    getLeaderboard,
    getRecentActivity,
    playerValhallanEvidenceById,
  }

  return {
    queries,

    async publishGeneration(
      authorization: RankingPublicationAuthorization,
      candidate: LeaderboardGenerationCandidate,
    ): Promise<PublicationResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        if (candidate.operationKey !== authorization.operationKey) throw new Error('candidate operation key mismatch')
        if (leaderboardModeFromOperationKind(authorization.operationKind) !== candidate.mode) {
          throw new Error('candidate mode does not match operation kind')
        }
        const requiredScopes: LeaderboardScope[] = ['all', ...regionalLeaderboardScopes]
        if (candidate.snapshots.size !== requiredScopes.length) throw new Error('candidate must contain ten scopes')
        for (const scope of requiredScopes) {
          const rows = candidate.snapshots.get(scope)
          if (!rows || rows.length === 0) throw new Error(`candidate scope ${scope} is empty`)
        }

        const effect = await recordOperationEffect(sql, authorization)
        if (effect === 'lease-lost' || effect === 'effect-conflict') return effect

        const effectOperationId = authorization.effectOperationId ?? authorization.operationId
        const [existing] = await sql<{ operation_id: string; operation_key: string; mode: LeaderboardMode }[]>`
          SELECT operation_id, operation_key, mode
          FROM rankings.generations
          WHERE operation_key = ${candidate.operationKey} OR operation_id = ${effectOperationId}
          LIMIT 1
        `
        if (existing) {
          return existing.operation_id === effectOperationId &&
            existing.operation_key === candidate.operationKey &&
            existing.mode === candidate.mode
            ? ('already-published' as const)
            : ('effect-conflict' as const)
        }
        if (effect === 'already-applied') throw new Error('leaderboard effect exists without its Ranking generation')

        const generationId = randomUUID()
        await sql`
          INSERT INTO rankings.generations
            (id, operation_id, operation_key, mode, observed_at, schedule_window_at,
             expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
          VALUES
            (${generationId}, ${effectOperationId}, ${candidate.operationKey}, ${candidate.mode},
             ${candidate.observedAt}, ${candidate.scheduleWindowAt}, ${candidate.expectedNextPublicationAt},
             ${candidate.pageDepth}, 'brawlhalla-v1-ranked-leaderboard', 2, false,
             ${sql.json({
               source: 'brawlhalla-v1-ranked-leaderboard',
               contractVersion: 2,
               pageDepth: candidate.pageDepth,
               scopePageDepths: candidate.scopePageDepths,
             })})
        `
        for (const scope of requiredScopes) {
          const rows = candidate.snapshots.get(scope)
          if (!rows) throw new Error(`candidate scope ${scope} disappeared during publication`)
          const snapshotId = randomUUID()
          await sql`
            INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
            VALUES (${snapshotId}, ${generationId}, ${candidate.mode}, ${scope}, ${rows.length})
          `
          const storedRows = rows.map((row, index) => ({
            snapshot_id: snapshotId,
            mode: candidate.mode,
            ordinal: index + 1,
            standing: row.standing,
            source_rank: row.sourceRank,
            ...storedIdentity(row.identity),
            region: row.region,
            rating: row.rating,
            peak_rating: row.peakRating,
            wins: row.wins,
            losses: row.losses,
            tier: row.tier,
          }))
          for (let offset = 0; offset < storedRows.length; offset += 500) {
            await sql`
              INSERT INTO rankings.snapshot_rows ${sql(
                storedRows.slice(offset, offset + 500),
                'snapshot_id',
                'mode',
                'ordinal',
                'standing',
                'source_rank',
                'identity_kind',
                'player_one_id',
                'player_one_name',
                'player_two_id',
                'player_two_name',
                'region',
                'rating',
                'peak_rating',
                'wins',
                'losses',
                'tier',
              )}
            `
          }
        }
        await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`
        return 'published' as const
      })
    },

    async recordCollectionFailure(
      authorization: RankingPublicationAuthorization,
      failure: { mode: LeaderboardMode; scope: LeaderboardScope; checkedAt: Date; code: string; message: string },
    ) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        if (leaderboardModeFromOperationKind(authorization.operationKind) !== failure.mode) {
          throw new Error('failure mode does not match operation kind')
        }
        if (!(await lockAuthorizedOperation(sql, authorization))) return 'lease-lost' as const
        const scheduleWindowAt = authorization.scheduleWindowAt
          ? new Date(authorization.scheduleWindowAt)
          : failure.checkedAt
        await sql`
          INSERT INTO rankings.collection_failures
            (id, mode, scope, operation_key, schedule_window_at, checked_at, code, message)
          VALUES
            (${randomUUID()}, ${failure.mode}, ${failure.scope}, ${authorization.operationKey}, ${scheduleWindowAt},
             ${failure.checkedAt}, ${failure.code}, ${failure.message})
        `
        return 'recorded' as const
      })
    },

    async close() {
      await client.end()
    },
  }
}

export type PostgresRanking = ReturnType<typeof createPostgresRanking>
