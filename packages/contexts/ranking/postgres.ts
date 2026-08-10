import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import type {
  Leaderboard1v1View,
  LeaderboardGenerationCandidate,
  LeaderboardScope,
  PublicationResult,
  RankingPublicationAuthorization,
  RankingQueries,
} from './leaderboard'
import { regionalLeaderboardScopes } from './v1-leaderboard-source'

type SnapshotRow = {
  snapshot_id: string
  generation_id: string
  scope: LeaderboardScope
  observed_at: Date
  published_at: Date
  expected_next_publication_at: Date
  page_depth: number
  source: 'brawlhalla-v1-ranked-leaderboard'
  source_contract_version: 1
  row_count: number
  latest_failure_at: Date | null
}

type StandingRow = {
  standing: number
  source_rank: number
  brawlhalla_id: number
  name: string
  region: (typeof regionalLeaderboardScopes)[number]
  rating: number
  peak_rating: number | null
  wins: number
  losses: number
  tier: string | null
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
        ${authorization.leaseOwner},
        ${authorization.leaseToken}
      ) AS result
    `
    return result?.result ?? 'lease-lost'
  }

  const queries: RankingQueries = {
    async get1v1(input): Promise<Leaderboard1v1View> {
      validateScope(input.region)
      const { page, pageSize } = boundedPagination(input.page, input.pageSize)
      const [snapshot] = await client<SnapshotRow[]>`
        SELECT snapshot.id AS snapshot_id, snapshot.generation_id, snapshot.scope,
               generation.observed_at, generation.published_at, generation.expected_next_publication_at,
               generation.page_depth, generation.source, generation.source_contract_version,
               snapshot.row_count,
               (
                 SELECT max(failure.checked_at)
                 FROM rankings.collection_failures failure
                 WHERE failure.schedule_window_at >= generation.schedule_window_at
               ) AS latest_failure_at
        FROM rankings.snapshots snapshot
        JOIN rankings.generations generation ON generation.id = snapshot.generation_id
        WHERE snapshot.scope = ${input.region}
          AND (${input.snapshotId ?? null}::uuid IS NULL OR snapshot.id = ${input.snapshotId ?? null})
        ORDER BY generation.schedule_window_at DESC, generation.id DESC
        LIMIT 1
      `
      if (!snapshot) {
        return {
          status: 'unavailable',
          reason: input.snapshotId ? 'snapshot_not_found' : 'not_yet_published',
          page,
          pageSize,
        }
      }

      const offset = (page - 1) * pageSize
      const entries = await client<StandingRow[]>`
        SELECT standing, source_rank, brawlhalla_id, name, region, rating, peak_rating, wins, losses, tier
        FROM rankings.snapshot_rows
        WHERE snapshot_id = ${snapshot.snapshot_id}
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
        region: snapshot.scope,
        observedAt: snapshot.observed_at.toISOString(),
        publishedAt: snapshot.published_at.toISOString(),
        expectedNextPublicationAt: snapshot.expected_next_publication_at.toISOString(),
        provenance: {
          source: snapshot.source,
          contractVersion: snapshot.source_contract_version,
          pageDepth: snapshot.page_depth,
        },
        page,
        pageSize,
        hasMore: offset + entries.length < snapshot.row_count,
        totalRows: snapshot.row_count,
        entries: entries.map((entry) => ({
          standing: entry.standing,
          sourceRank: entry.source_rank,
          brawlhallaId: entry.brawlhalla_id,
          name: entry.name,
          region: entry.region,
          rating: entry.rating,
          peakRating: entry.peak_rating,
          wins: entry.wins,
          losses: entry.losses,
          games: entry.wins + entry.losses,
          tier: entry.tier,
        })),
      }
    },
  }

  return {
    queries,

    async publish1v1Generation(
      authorization: RankingPublicationAuthorization,
      candidate: LeaderboardGenerationCandidate,
    ): Promise<PublicationResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        if (candidate.operationKey !== authorization.operationKey) throw new Error('candidate operation key mismatch')
        const requiredScopes: LeaderboardScope[] = ['all', ...regionalLeaderboardScopes]
        if (candidate.snapshots.size !== requiredScopes.length) throw new Error('candidate must contain ten scopes')
        for (const scope of requiredScopes) {
          const rows = candidate.snapshots.get(scope)
          if (!rows || rows.length === 0) throw new Error(`candidate scope ${scope} is empty`)
        }

        const effect = await recordOperationEffect(sql, authorization)
        if (effect === 'lease-lost' || effect === 'effect-conflict') return effect

        const effectOperationId = authorization.effectOperationId ?? authorization.operationId
        const [existing] = await sql<{ operation_id: string; operation_key: string }[]>`
          SELECT operation_id, operation_key
          FROM rankings.generations
          WHERE operation_key = ${candidate.operationKey} OR operation_id = ${effectOperationId}
          LIMIT 1
        `
        if (existing) {
          return existing.operation_id === effectOperationId && existing.operation_key === candidate.operationKey
            ? ('already-published' as const)
            : ('effect-conflict' as const)
        }
        if (effect === 'already-applied') {
          throw new Error('leaderboard effect exists without its Ranking generation')
        }

        const generationId = randomUUID()
        await sql`
          INSERT INTO rankings.generations
            (id, operation_id, operation_key, observed_at, schedule_window_at,
             expected_next_publication_at, page_depth, source, source_contract_version)
          VALUES
            (${generationId}, ${effectOperationId}, ${candidate.operationKey}, ${candidate.observedAt},
             ${candidate.scheduleWindowAt}, ${candidate.expectedNextPublicationAt}, ${candidate.pageDepth},
             'brawlhalla-v1-ranked-leaderboard', 1)
        `
        for (const scope of requiredScopes) {
          const rows = candidate.snapshots.get(scope)
          if (!rows) throw new Error(`candidate scope ${scope} disappeared during publication`)
          const snapshotId = randomUUID()
          await sql`
            INSERT INTO rankings.snapshots (id, generation_id, scope, row_count)
            VALUES (${snapshotId}, ${generationId}, ${scope}, ${rows.length})
          `
          const storedRows = rows.map((row, index) => ({
            snapshot_id: snapshotId,
            ordinal: index + 1,
            standing: row.standing,
            source_rank: row.sourceRank,
            brawlhalla_id: row.brawlhallaId,
            name: row.name,
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
                'ordinal',
                'standing',
                'source_rank',
                'brawlhalla_id',
                'name',
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
        return 'published' as const
      })
    },

    async record1v1CollectionFailure(
      authorization: RankingPublicationAuthorization,
      failure: { checkedAt: Date; code: string; message: string },
    ) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        if (!(await lockAuthorizedOperation(sql, authorization))) return 'lease-lost' as const
        const scheduleWindowAt = authorization.scheduleWindowAt
          ? new Date(authorization.scheduleWindowAt)
          : failure.checkedAt
        await sql`
          INSERT INTO rankings.collection_failures
            (id, operation_key, schedule_window_at, checked_at, code, message)
          VALUES
            (${randomUUID()}, ${authorization.operationKey}, ${scheduleWindowAt}, ${failure.checkedAt},
             ${failure.code}, ${failure.message})
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
