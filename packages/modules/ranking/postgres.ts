import { randomUUID } from 'node:crypto'
import type { Database, Sql } from '@brawltome/foundation'
import {
  completeRankingRetentionLease,
  lockActiveLeaderboardLease,
  lockActiveRankingRetentionLease,
} from '@brawltome/queue'
import {
  type ActivityRow,
  activityColumns,
  activityEntry,
  type ComparedSnapshots,
  playedRows,
} from './db/activity-rows'
import { publishRegionGeneration, publishWindowGeneration } from './db/publish-generation'
import { readRecentMovers } from './db/recent-movers'
import { readLatestRegionalBoards } from './db/regional-boards'
import { rowsByRating } from './db/rows-by-rating'
import { publishedIdentity, type StoredIdentityRow } from './db/stored-identity'
import type {
  LeaderboardGenerationCandidate,
  LeaderboardScope,
  LeaderboardView,
  PlayerValhallanEvidence,
  PlayerValhallanQueries,
  PublicationResult,
  RankingPublicationAuthorization,
  RankingQueries,
  RecentActivityView,
  RecentMoversQueries,
  RecentMoversView,
} from './leaderboard'
import { leaderboardModeFromOperationKind } from './leaderboard'
import {
  type RankingRetentionAuthorization,
  type RankingRetentionInput,
  type RankingRetentionResult,
  validateRankingRetentionInput,
} from './retention'
import {
  type LeaderboardMode,
  leaderboardModes,
  type RegionalLeaderboardScope,
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
  previous_provenance: Record<string, unknown> | null
  previous_schedule_window_at: Date | null
}

type ActivityIntervalLookupRow = Omit<ActivityIntervalRow, 'previous_snapshot_id' | 'previous_observed_at'> & {
  previous_snapshot_id: string | null
  previous_observed_at: Date | null
  has_earlier_scans: boolean
}

type ActivityInterval =
  | { status: 'found'; interval: ActivityIntervalRow }
  | { status: 'unavailable'; reason: Extract<RecentActivityView, { status: 'unavailable' }>['reason'] }

type ActivityIntervalInput = { mode: LeaderboardMode; region: LeaderboardScope; snapshotId?: string }

type ActivityStandingRow = ActivityRow & { total_count: number }

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

// a global board that carries a region from an earlier scan is only as fresh as that region
function carriesStaleRegions(snapshot: SnapshotRow): boolean {
  const staleRegions = snapshot.provenance.staleRegions

  return snapshot.scope === 'all' && Array.isArray(staleRegions) && staleRegions.length > 0
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

// scans land about hourly and at uneven times, so a closer one covers too little play to stand for the last hour
const shortestComparedSpan = '45 minutes'
// further back, the comparison no longer reads as recent play
const longestComparedSpan = '2 hours'
// scans this old only show the board had history, not that the collector skipped a scan
const scanGapLookback = '6 hours'

/**
 * Finds the board's latest snapshot between 45 minutes and 2 hours before its newest one. Each region publishes on its
 * own, so only scans of the asked board count: a region the source keeps failing compares its own last scans and
 * keeps its own age. Scans before that range, up to six hours back, mean the collector skipped scans, which clears up
 * after the next scan. Without them the board is too new to compare.
 */
async function readActivityInterval(sql: Sql, input: ActivityIntervalInput): Promise<ActivityInterval> {
  const [row] = await sql<ActivityIntervalLookupRow[]>`
    WITH board_scans AS (
      SELECT snapshot.id AS snapshot_id, snapshot.generation_id, snapshot.mode, snapshot.scope,
             generation.observed_at, generation.schedule_window_at, generation.published_at,
             generation.expected_next_publication_at, generation.page_depth, generation.source,
             generation.source_contract_version, generation.provenance, snapshot.row_count
      FROM rankings.snapshots snapshot
      JOIN rankings.generations generation
        ON generation.id = snapshot.generation_id AND generation.mode = snapshot.mode
      WHERE generation.finalized
        AND generation.source = 'brawlhalla-v1-ranked-leaderboard'
        AND snapshot.mode = ${input.mode}
        AND snapshot.scope = ${input.region}
    ), current_endpoint AS (
      SELECT scan.*
      FROM board_scans scan
      WHERE ${input.snapshotId ?? null}::uuid IS NULL OR scan.snapshot_id = ${input.snapshotId ?? null}
      ORDER BY scan.schedule_window_at DESC, scan.generation_id DESC
      LIMIT 1
    )
    SELECT current_endpoint.*,
           previous_scan.snapshot_id AS previous_snapshot_id,
           previous_scan.observed_at AS previous_observed_at,
           previous_scan.provenance AS previous_provenance,
           previous_scan.schedule_window_at AS previous_schedule_window_at,
           EXISTS (
             SELECT 1
             FROM board_scans earlier_scan
             WHERE earlier_scan.schedule_window_at < current_endpoint.schedule_window_at - ${longestComparedSpan}::interval
               AND earlier_scan.schedule_window_at >= current_endpoint.schedule_window_at - ${scanGapLookback}::interval
           ) AS has_earlier_scans
    FROM current_endpoint
    LEFT JOIN LATERAL (
      SELECT scan.snapshot_id, scan.observed_at, scan.provenance, scan.schedule_window_at
      FROM board_scans scan
      WHERE scan.schedule_window_at <= current_endpoint.schedule_window_at - ${shortestComparedSpan}::interval
        AND scan.schedule_window_at >= current_endpoint.schedule_window_at - ${longestComparedSpan}::interval
      ORDER BY scan.schedule_window_at DESC, scan.generation_id DESC
      LIMIT 1
    ) previous_scan ON true
  `

  if (!row) return { status: 'unavailable', reason: 'not_enough_history' }

  const { previous_snapshot_id: previousSnapshotId, previous_observed_at: previousObservedAt } = row

  if (previousSnapshotId === null || previousObservedAt === null) {
    return { status: 'unavailable', reason: row.has_earlier_scans ? 'scan_gap' : 'not_enough_history' }
  }

  const interval = { ...row, previous_snapshot_id: previousSnapshotId, previous_observed_at: previousObservedAt }

  return { status: 'found', interval }
}

function staleRegionsOf(provenance: Record<string, unknown> | null): string[] {
  const staleRegions = provenance?.staleRegions

  return Array.isArray(staleRegions) ? staleRegions.filter((region) => typeof region === 'string') : []
}

type CarriedBoard = { windowAt: Date; region: string }

function carriedBoardsOf(interval: ActivityIntervalRow): CarriedBoard[] {
  const current = staleRegionsOf(interval.provenance).map((region) => ({
    windowAt: interval.schedule_window_at,
    region,
  }))

  const previousWindowAt = interval.previous_schedule_window_at

  if (!previousWindowAt) return current

  const previous = staleRegionsOf(interval.previous_provenance).map((region) => ({
    windowAt: previousWindowAt,
    region,
  }))

  return [...current, ...previous]
}

// a global board carried the region's latest board from before its own window, so that is the board to look up
async function readCarriedSnapshotIds(sql: Sql, mode: LeaderboardMode, carried: CarriedBoard[]): Promise<string[]> {
  const windows = carried.map(({ windowAt }) => windowAt.toISOString())
  const regions = carried.map(({ region }) => region)

  const rows = await sql<{ snapshot_id: string }[]>`
    SELECT DISTINCT ON (carried.window_at, carried.scope) snapshot.id AS snapshot_id
    FROM unnest(${windows}::timestamptz[], ${regions}::text[]) AS carried(window_at, scope)
    JOIN rankings.snapshots snapshot ON snapshot.mode = ${mode} AND snapshot.scope = carried.scope
    JOIN rankings.generations generation
      ON generation.id = snapshot.generation_id AND generation.mode = snapshot.mode
    WHERE generation.finalized
      AND generation.source = 'brawlhalla-v1-ranked-leaderboard'
      AND generation.schedule_window_at < carried.window_at
    ORDER BY carried.window_at, carried.scope, generation.schedule_window_at DESC, generation.id DESC
  `

  return rows.map(({ snapshot_id }) => snapshot_id)
}

// a global board carries a failed region's board from an earlier scan, so comparing either end of the interval with
// it would show no games during the outage and all of them in the scan where the region comes back
async function readComparedSnapshots(sql: Sql, interval: ActivityIntervalRow): Promise<ComparedSnapshots> {
  const carried = carriedBoardsOf(interval)
  const carriedSnapshotIds = carried.length > 0 ? await readCarriedSnapshotIds(sql, interval.mode, carried) : []

  return {
    currentSnapshotId: interval.snapshot_id,
    previousSnapshotId: interval.previous_snapshot_id,
    carriedSnapshotIds,
  }
}

export function createPostgresRanking(
  database: Database,
  // Test seam: runs inside the read transaction after the snapshot metadata is selected.
  options: { afterMetadataRead?: () => Promise<void> } = {},
) {
  const client = database.sql

  async function playerValhallanEvidenceById(brawlhallaId: number): Promise<PlayerValhallanEvidence | null> {
    if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1) throw new Error('brawlhallaId must be positive')

    const rows = await client<
      Array<{
        mode: '1v1' | '2v2' | 'solo2v2'
        player_one_id: number
        player_two_id: number | null
      }>
    >`
      WITH latest_global AS (
        SELECT DISTINCT ON (snapshot.mode) snapshot.id, snapshot.mode
        FROM rankings.snapshots snapshot
        JOIN rankings.generations generation
          ON generation.id = snapshot.generation_id AND generation.mode = snapshot.mode
        WHERE generation.finalized
          AND generation.source = 'brawlhalla-v1-ranked-leaderboard'
          AND snapshot.mode IN ('1v1', '2v2', 'solo2v2')
          AND snapshot.scope = 'all'
        ORDER BY snapshot.mode, generation.schedule_window_at DESC, generation.id DESC
      )
      SELECT row.mode, row.player_one_id, row.player_two_id
      FROM latest_global snapshot
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

    // One repeatable-read snapshot so retention cannot delete the selected snapshot between the
    // metadata read and the row read.
    return client.begin('isolation level repeatable read read only', async (transaction) => {
      const sql = transaction as unknown as typeof client

      const [snapshot] = await sql<SnapshotRow[]>`
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

      await options.afterMetadataRead?.()
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

      const entries = await sql<StandingRow[]>`
      SELECT rating_standing AS standing, source_rank, identity_kind, player_one_id, player_one_name,
             player_two_id, player_two_name, region, rating, peak_rating, wins, losses, tier
      FROM (${rowsByRating(sql, snapshot.snapshot_id)}) ranked
      ORDER BY rating_standing
      OFFSET ${offset}
      LIMIT ${pageSize}
    `

      const now = input.now ?? new Date()

      const stale =
        now >= snapshot.expected_next_publication_at ||
        (snapshot.latest_failure_at !== null && snapshot.latest_failure_at > snapshot.published_at) ||
        carriesStaleRegions(snapshot)

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
    })
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

    // One repeatable-read snapshot so retention cannot delete the selected snapshot between the
    // metadata read and the row read.
    return client.begin('isolation level repeatable read read only', async (transaction) => {
      const sql = transaction as unknown as typeof client
      const lookup = await readActivityInterval(sql, input)

      await options.afterMetadataRead?.()
      if (lookup.status === 'unavailable') {
        return {
          status: 'unavailable',
          reason: lookup.reason,
          mode: input.mode,
          region: input.region,
          page,
          pageSize,
        }
      }

      const { interval } = lookup
      const compared = await readComparedSnapshots(sql, interval)
      const offset = (page - 1) * pageSize

      const entries = await sql<ActivityStandingRow[]>`
      SELECT ${activityColumns(sql)},
             (count(*) OVER ())::integer AS total_count
      ${playedRows(sql, compared)}
      ORDER BY current.rating_standing
      OFFSET ${offset}
      LIMIT ${pageSize}
    `

      let totalRows = entries[0]?.total_count ?? 0

      if (entries.length === 0 && offset > 0) {
        const [count] = await sql<{ total_count: number }[]>`
        SELECT count(*)::integer AS total_count
        ${playedRows(sql, compared)}
      `

        totalRows = count?.total_count ?? 0
      }

      const now = input.now ?? new Date()

      const publicationIntervalMs =
        interval.expected_next_publication_at.getTime() - interval.schedule_window_at.getTime()

      const stale = now.getTime() >= interval.expected_next_publication_at.getTime() + publicationIntervalMs
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
        entries: entries.map(activityEntry),
      }
    })
  }

  async function getRecentMovers(input: {
    mode: LeaderboardMode
    region: LeaderboardScope
  }): Promise<RecentMoversView> {
    validateMode(input.mode)
    validateScope(input.region)

    // one snapshot of the database, so retention cannot delete either end of the hour between the two reads
    return client.begin('isolation level repeatable read read only', async (transaction) => {
      const sql = transaction as unknown as typeof client
      const lookup = await readActivityInterval(sql, input)

      if (lookup.status === 'unavailable') {
        return { status: 'unavailable', reason: lookup.reason, mode: input.mode, region: input.region }
      }

      const { interval } = lookup
      const compared = await readComparedSnapshots(sql, interval)
      const movers = await readRecentMovers(sql, compared)

      return {
        status: 'available',
        mode: interval.mode,
        region: interval.scope,
        currentSnapshotId: interval.snapshot_id,
        ...movers,
      }
    })
  }

  const queries: RankingQueries & PlayerValhallanQueries & RecentMoversQueries = {
    getLeaderboard,
    getRecentActivity,
    getRecentMovers,
    playerValhallanEvidenceById,
  }

  return {
    queries,

    readLatestRegionalBoards(mode: LeaderboardMode) {
      validateMode(mode)

      return readLatestRegionalBoards(client, mode)
    },

    async publishRegion(
      authorization: RankingPublicationAuthorization,
      candidate: LeaderboardGenerationCandidate,
    ): Promise<PublicationResult> {
      return client.begin((transaction) =>
        publishRegionGeneration(transaction as unknown as typeof client, authorization, candidate),
      )
    },

    async publishGeneration(
      authorization: RankingPublicationAuthorization,
      candidate: LeaderboardGenerationCandidate,
    ): Promise<PublicationResult> {
      return client.begin((transaction) =>
        publishWindowGeneration(transaction as unknown as typeof client, authorization, candidate),
      )
    },

    // The retention delete commits only while this worker still holds the maintenance lease: the lease row stays
    // locked until commit, so an expired or replaced lease cannot delete a batch twice or after a takeover. The
    // operation is completed in the same transaction, so a batch that outlives the lease is not re-run.
    async expireGenerations(
      authorization: RankingRetentionAuthorization,
      input: RankingRetentionInput,
    ): Promise<RankingRetentionResult> {
      const { retentionHours, maxGenerations } = validateRankingRetentionInput(input)

      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client

        if (!(await lockActiveRankingRetentionLease(sql, authorization))) return { outcome: 'lease-lost' as const }

        const [expired] = await sql<{ deleted_generations: number; expirable_generations: number }[]>`
          SELECT deleted_generations, expirable_generations
          FROM rankings.expire_v1_generations(
            clock_timestamp() - make_interval(hours => ${retentionHours}::integer),
            ${maxGenerations}::integer
          )
        `

        const isCompleted = await completeRankingRetentionLease(sql, authorization)

        // The lease row has been locked since the check above, so completion cannot lose it; fail loudly if it did.
        if (!isCompleted) throw new Error('ranking retention lease changed while its row was locked')

        return {
          outcome: 'completed' as const,
          deletedGenerations: expired?.deleted_generations ?? 0,
          expirableGenerations: expired?.expirable_generations ?? 0,
        }
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

        if (!(await lockActiveLeaderboardLease(sql, authorization))) return 'lease-lost' as const

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
  }
}

export type PostgresRanking = ReturnType<typeof createPostgresRanking>
