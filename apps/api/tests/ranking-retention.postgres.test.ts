import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { LeaderboardMode, LeaderboardScope } from '@brawltome/ranking'
import { createPostgresRanking, rankingMigrationInventory } from '@brawltome/ranking/composition'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import { requestAdmissionMigrationInventory } from '@brawltome/request-admission/composition'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import postgres from 'postgres'
import { rankingRetentionScheduleDefinition, readOperationsWorkerConfig } from '../src/operations-worker-config'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

const baseUrl = process.env.DATABASE_URL
const hour = 60 * 60 * 1000
const minute = 60 * 1000
const v1Source = 'brawlhalla-v1-ranked-leaderboard'
const runtimeRole = 'brawltome_runtime'
const admission = {
  totalConcurrency: 8,
  interactiveReservation: 2,
  classConcurrency: {
    interactive: 4,
    'primary-monitoring': 2,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 2,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
} as const
let admin: ReturnType<typeof postgres>
let createdRuntimeRole = false
const databases: string[] = []

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Ranking retention PostgreSQL tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  // Production creates the runtime role before migrations run; mirror that so the migration's grant is exercised.
  const [existing] = await admin<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${runtimeRole}) AS exists
  `
  if (!existing?.exists) {
    await admin.unsafe(`CREATE ROLE ${runtimeRole} NOLOGIN`)
    createdRuntimeRole = true
  }
})

afterAll(async () => {
  if (!admin) return
  for (const name of databases) await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  if (createdRuntimeRole) await admin.unsafe(`DROP ROLE IF EXISTS ${runtimeRole}`)
  await admin.end()
})

async function migratedDatabase() {
  const name = `bt_retention_${process.pid}_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  databases.push(name)
  const url = new URL(baseUrl as string)
  url.pathname = `/${name}`
  const sql = postgres(url.toString(), { max: 4, onnotice: () => undefined })
  for (const migration of [
    ...refreshOperationsMigrationInventory,
    ...requestAdmissionMigrationInventory,
    ...rankingMigrationInventory,
  ]) {
    await sql.unsafe(migration.sql)
  }
  return { url: url.toString(), sql }
}

type Sql = ReturnType<typeof postgres>

async function databaseNow(sql: Sql): Promise<Date> {
  const [row] = await sql<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  if (!row) throw new Error('Expected database time')
  return row.now
}

type GenerationFixture = { generationId: string; snapshots: Record<LeaderboardScope, string> }

async function insertGeneration(
  sql: Sql,
  input: {
    mode: LeaderboardMode
    windowAt: Date
    source?: 'v1' | 'v2-legacy'
    finalized?: boolean
    wins?: number
  },
): Promise<GenerationFixture> {
  const generationId = randomUUID()
  const legacy = input.source === 'v2-legacy'
  const provenance = legacy
    ? {
        source: 'v2-legacy',
        contractVersion: 1,
        sourceChecksum: 'a'.repeat(64),
        importedAt: input.windowAt.toISOString(),
        completeness: 'frozen-repository-rows',
      }
    : { source: v1Source, contractVersion: 2, pageDepth: 1 }
  await sql`
    INSERT INTO rankings.generations
      (id, operation_id, operation_key, mode, observed_at, schedule_window_at, published_at,
       expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
    VALUES
      (${generationId}, ${randomUUID()}, ${`retention-test:${generationId}`}, ${input.mode},
       ${new Date(input.windowAt.getTime() + 1_000)}, ${input.windowAt}, ${new Date(input.windowAt.getTime() + 2_000)},
       ${new Date(input.windowAt.getTime() + 15 * minute)}, ${legacy ? null : 1}, ${legacy ? 'v2-legacy' : v1Source},
       ${legacy ? 1 : 2}, false, ${sql.json(provenance)})
  `
  const snapshots = {} as Record<LeaderboardScope, string>
  for (const scope of ['all', 'EU'] as const) {
    const snapshotId = randomUUID()
    snapshots[scope] = snapshotId
    await sql`
      INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
      VALUES (${snapshotId}, ${generationId}, ${input.mode}, ${scope}, 2)
    `
    for (const ordinal of [1, 2]) {
      const playerOne = 1_000 + ordinal
      const team = input.mode === '2v2'
      const identityKind =
        input.mode === '1v1'
          ? 'one-vs-one-player'
          : team
            ? 'fixed-two-vs-two-team'
            : input.mode === 'solo2v2'
              ? 'solo-two-vs-two-player'
              : 'three-vs-three-player'
      await sql`
        INSERT INTO rankings.snapshot_rows
          (snapshot_id, mode, ordinal, standing, source_rank, identity_kind, player_one_id, player_one_name,
           player_two_id, player_two_name, region, rating, peak_rating, wins, losses, tier)
        VALUES
          (${snapshotId}, ${input.mode}, ${ordinal}, ${ordinal}, ${ordinal}, ${identityKind}, ${playerOne},
           ${`Player ${playerOne}`}, ${team ? playerOne + 10_000 : null}, ${team ? `Mate ${playerOne}` : null}, 'EU',
           ${2_000 - ordinal}, ${2_100 - ordinal}, ${input.wins ?? 10}, 5, 'Diamond')
      `
    }
  }
  if (input.finalized !== false) {
    await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`
  }
  return { generationId, snapshots }
}

async function referenceFromLegacyImportSet(
  sql: Sql,
  mode: LeaderboardMode,
  scope: 'EU' | 'US-E',
  fixture: GenerationFixture,
) {
  await sql`
    INSERT INTO rankings.legacy_import_sets
      (mode, scope, status, source_row_count, candidate_row_count, gates, reasons, source_checksum,
       generation_id, snapshot_id)
    VALUES
      (${mode}, ${scope}, 'accepted', 2, 2, ${sql.json({})}, ${sql.array([] as string[])}, ${'b'.repeat(64)},
       ${fixture.generationId}, ${fixture.snapshots.EU})
  `
}

async function storedGenerationIds(sql: Sql): Promise<string[]> {
  return (await sql<{ id: string }[]>`SELECT id FROM rankings.generations ORDER BY schedule_window_at, id`).map(
    ({ id }) => id,
  )
}

async function storedGenerationIdsVisibleTo(transaction: postgres.TransactionSql): Promise<string[]> {
  return (await transaction<{ id: string }[]>`SELECT id FROM rankings.generations ORDER BY schedule_window_at, id`).map(
    ({ id }) => id,
  )
}

async function orphanCounts(sql: Sql, generationIds: string[]) {
  const [counts] = await sql<{ snapshots: number; rows: number }[]>`
    SELECT
      (SELECT count(*)::int FROM rankings.snapshots WHERE generation_id = ANY(${sql.array(generationIds)}::uuid[]))
        AS snapshots,
      (SELECT count(*)::int FROM rankings.snapshot_rows row
         JOIN rankings.snapshots snapshot ON snapshot.id = row.snapshot_id
         WHERE snapshot.generation_id = ANY(${sql.array(generationIds)}::uuid[])) AS rows
  `
  return counts
}

async function expire(sql: Sql, cutoff: Date, maxGenerations: number): Promise<number> {
  const [row] = await sql<{ deleted: number }[]>`
    SELECT rankings.expire_v1_generations(${cutoff}, ${maxGenerations}) AS deleted
  `
  return row?.deleted ?? -1
}

async function errorMessage(work: () => Promise<unknown>): Promise<string> {
  try {
    await work()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return 'no error'
}

describe('Ranking snapshot retention', () => {
  test('expires only old finalized V1 generations, oldest first, keeping protected history', async () => {
    const { sql } = await migratedDatabase()
    try {
      const now = await databaseNow(sql)
      const at = (offsetMs: number) => new Date(now.getTime() - offsetMs)
      const oneVsOneOld = [
        await insertGeneration(sql, { mode: '1v1', windowAt: at(30 * hour) }),
        await insertGeneration(sql, { mode: '1v1', windowAt: at(28 * hour) }),
        await insertGeneration(sql, { mode: '1v1', windowAt: at(26 * hour) }),
      ]
      const oneVsOneRecent = [
        await insertGeneration(sql, { mode: '1v1', windowAt: at(20 * hour) }),
        await insertGeneration(sql, { mode: '1v1', windowAt: at(1 * hour) }),
        await insertGeneration(sql, { mode: '1v1', windowAt: at(15 * minute) }),
      ]
      // 2v2 stopped publishing long ago: only its oldest generation may go; the newest two stay regardless of age.
      const twoVsTwoOldest = await insertGeneration(sql, { mode: '2v2', windowAt: at(41 * hour) })
      const twoVsTwoNewest = [
        await insertGeneration(sql, { mode: '2v2', windowAt: at(40 * hour) }),
        await insertGeneration(sql, { mode: '2v2', windowAt: at(39 * hour) }),
      ]
      // 3v3: an old V1 generation still referenced by legacy migration evidence is never expired.
      const referencedV1 = await insertGeneration(sql, { mode: '3v3', windowAt: at(50 * hour) })
      await referenceFromLegacyImportSet(sql, '3v3', 'EU', referencedV1)
      const threeVsThreeNewest = [
        await insertGeneration(sql, { mode: '3v3', windowAt: at(2 * hour) }),
        await insertGeneration(sql, { mode: '3v3', windowAt: at(1 * hour) }),
      ]
      // solo2v2: frozen v2-legacy history and an unfinalized publication are never touched.
      const legacy = await insertGeneration(sql, { mode: 'solo2v2', windowAt: at(100 * hour), source: 'v2-legacy' })
      await referenceFromLegacyImportSet(sql, 'solo2v2', 'EU', legacy)
      const unreferencedLegacy = await insertGeneration(sql, {
        mode: '1v1',
        windowAt: at(90 * hour),
        source: 'v2-legacy',
      })
      const unfinalized = await insertGeneration(sql, { mode: 'solo2v2', windowAt: at(60 * hour), finalized: false })

      const cutoff = at(24 * hour)
      expect(await expire(sql, cutoff, 2)).toBe(2)
      const afterFirstBatch = await storedGenerationIds(sql)
      expect(afterFirstBatch).not.toContain(twoVsTwoOldest.generationId)
      expect(afterFirstBatch).not.toContain(oneVsOneOld[0]?.generationId)
      expect(afterFirstBatch).toContain(oneVsOneOld[1]?.generationId)
      expect(afterFirstBatch).toContain(oneVsOneOld[2]?.generationId)

      expect(await expire(sql, cutoff, 100)).toBe(2)
      expect(await expire(sql, cutoff, 100)).toBe(0)

      const expired = [twoVsTwoOldest, ...oneVsOneOld].map(({ generationId }) => generationId)
      const kept = [
        ...oneVsOneRecent,
        ...twoVsTwoNewest,
        referencedV1,
        ...threeVsThreeNewest,
        legacy,
        unreferencedLegacy,
        unfinalized,
      ].map(({ generationId }) => generationId)
      const remaining = await storedGenerationIds(sql)
      expect(remaining.sort()).toEqual([...kept].sort())
      expect(await orphanCounts(sql, expired)).toEqual({ snapshots: 0, rows: 0 })
      expect(await orphanCounts(sql, kept)).toEqual({ snapshots: kept.length * 2, rows: kept.length * 4 })
    } finally {
      await sql.end()
    }
  }, 30_000)

  test('keeps a generation exactly at the cutoff and one protected only through its snapshot', async () => {
    const { sql } = await migratedDatabase()
    try {
      const now = await databaseNow(sql)
      const cutoff = new Date(now.getTime() - 26 * hour)
      const beforeCutoff = await insertGeneration(sql, { mode: '1v1', windowAt: new Date(cutoff.getTime() - 1) })
      const atCutoff = await insertGeneration(sql, { mode: '1v1', windowAt: cutoff })
      // Legacy evidence may name a different generation than the snapshot it pins; the snapshot alone protects.
      const pinnedBySnapshot = await insertGeneration(sql, {
        mode: '1v1',
        windowAt: new Date(now.getTime() - 40 * hour),
      })
      const legacy = await insertGeneration(sql, {
        mode: '1v1',
        windowAt: new Date(now.getTime() - 90 * hour),
        source: 'v2-legacy',
      })
      await sql`
        INSERT INTO rankings.legacy_import_sets
          (mode, scope, status, source_row_count, candidate_row_count, gates, reasons, source_checksum,
           generation_id, snapshot_id)
        VALUES
          ('1v1', 'EU', 'accepted', 2, 2, ${sql.json({})}, ${sql.array([] as string[])}, ${'b'.repeat(64)},
           ${legacy.generationId}, ${pinnedBySnapshot.snapshots.EU})
      `
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * minute) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 15 * minute) })

      expect(await expire(sql, cutoff, 100)).toBe(1)
      const remaining = await storedGenerationIds(sql)
      expect(remaining).not.toContain(beforeCutoff.generationId)
      expect(remaining).toContain(atCutoff.generationId)
      expect(remaining).toContain(pinnedBySnapshot.generationId)
      expect(await orphanCounts(sql, [atCutoff.generationId, pinnedBySnapshot.generationId])).toEqual({
        snapshots: 4,
        rows: 8,
      })
    } finally {
      await sql.end()
    }
  }, 30_000)

  test('lets concurrent expiry calls delete disjoint batches without blocking or failing', async () => {
    const { sql } = await migratedDatabase()
    try {
      const now = await databaseNow(sql)
      const old = []
      for (let index = 0; index < 6; index++) {
        old.push(await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - (40 - index) * hour) }))
      }
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * minute) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 15 * minute) })
      const cutoff = new Date(now.getTime() - 24 * hour)
      const expiredBy = async (transaction: postgres.TransactionSql) =>
        (await storedGenerationIdsVisibleTo(transaction)).length

      // The first call holds its locked batch open while the second runs: SKIP LOCKED hands it the rest.
      let release: () => void = () => undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let firstStarted: () => void = () => undefined
      const started = new Promise<void>((resolve) => {
        firstStarted = resolve
      })
      const before = await storedGenerationIds(sql)
      const first = sql.begin(async (transaction) => {
        const [row] = await transaction<{ deleted: number }[]>`
          SELECT rankings.expire_v1_generations(${cutoff}, 3) AS deleted
        `
        const visible = await expiredBy(transaction)
        firstStarted()
        await held
        return { deleted: row?.deleted, visible }
      })
      await started
      const second = await sql.begin(async (transaction) => {
        const [row] = await transaction<{ deleted: number }[]>`
          SELECT rankings.expire_v1_generations(${cutoff}, 3) AS deleted
        `
        return { deleted: row?.deleted, remaining: await storedGenerationIdsVisibleTo(transaction) }
      })
      release()
      const firstResult = await first
      expect(firstResult.deleted).toBe(3)
      expect(second.deleted).toBe(3)
      const firstDeleted = before.length - firstResult.visible
      expect(firstDeleted).toBe(3)

      const remaining = await storedGenerationIds(sql)
      for (const { generationId } of old) expect(remaining).not.toContain(generationId)
      expect(remaining).toHaveLength(2)
      // The second call's batch was the three the first did not lock.
      const secondDeleted = before.filter((id) => !second.remaining.includes(id))
      expect(secondDeleted).toHaveLength(3)
      expect(
        await orphanCounts(
          sql,
          old.map(({ generationId }) => generationId),
        ),
      ).toEqual({ snapshots: 0, rows: 0 })

      // Unsynchronised concurrent calls with nothing left also succeed.
      expect(await Promise.all([expire(sql, cutoff, 5), expire(sql, cutoff, 5)])).toEqual([0, 0])
    } finally {
      await sql.end()
    }
  }, 30_000)

  test('leaves a publication that is still being written untouched while expiring', async () => {
    const { sql } = await migratedDatabase()
    try {
      const now = await databaseNow(sql)
      const expired = await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 40 * hour) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * minute) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 15 * minute) })

      let release: () => void = () => undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let written: () => void = () => undefined
      const inProgress = new Promise<void>((resolve) => {
        written = resolve
      })
      // An unfinalized generation (even an old window) is mid-publication in another open transaction.
      const publication = sql.begin(async (transaction) => {
        const fixture = await insertGeneration(transaction as unknown as Sql, {
          mode: '1v1',
          windowAt: new Date(now.getTime() - 50 * hour),
          finalized: false,
        })
        written()
        await held
        await transaction`UPDATE rankings.generations SET finalized = true WHERE id = ${fixture.generationId}`
        return fixture
      })
      await inProgress
      expect(await expire(sql, new Date(now.getTime() - 24 * hour), 100)).toBe(1)
      release()
      const published = await publication

      const remaining = await storedGenerationIds(sql)
      expect(remaining).not.toContain(expired.generationId)
      expect(remaining).toContain(published.generationId)
      expect(await orphanCounts(sql, [published.generationId])).toEqual({ snapshots: 2, rows: 4 })
      const [finalized] = await sql<{ finalized: boolean }[]>`
        SELECT finalized FROM rankings.generations WHERE id = ${published.generationId}
      `
      expect(finalized?.finalized).toBe(true)
    } finally {
      await sql.end()
    }
  }, 30_000)

  test('rejects cutoffs inside the minimum window and unbounded batches', async () => {
    const { sql } = await migratedDatabase()
    try {
      const now = await databaseNow(sql)
      for (const cutoff of [new Date(now.getTime() - 1 * hour), new Date(now.getTime() - 23 * hour)]) {
        expect(await errorMessage(() => expire(sql, cutoff, 10))).toContain(
          'ranking retention cutoff must be at least 24 hours in the past',
        )
      }
      for (const batch of [0, 201, 1000]) {
        expect(await errorMessage(() => expire(sql, new Date(now.getTime() - 24 * hour), batch))).toContain(
          'ranking retention batch must be between 1 and 200',
        )
      }
      expect(await expire(sql, new Date(now.getTime() - 24 * hour), 200)).toBe(0)
    } finally {
      await sql.end()
    }
  }, 30_000)

  test('keeps every other UPDATE, DELETE, and TRUNCATE path immutable', async () => {
    const { sql } = await migratedDatabase()
    try {
      const now = await databaseNow(sql)
      const old = await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * hour) })
      const recent = await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 2 * hour) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 1 * hour) })
      const immutable = 'published ranking snapshots are immutable'

      for (const statement of [
        `DELETE FROM rankings.snapshot_rows WHERE snapshot_id = '${old.snapshots.all}'`,
        `DELETE FROM rankings.snapshots WHERE id = '${old.snapshots.all}'`,
        `DELETE FROM rankings.generations WHERE id = '${old.generationId}'`,
        'TRUNCATE rankings.snapshot_rows',
        'TRUNCATE rankings.snapshots CASCADE',
        'TRUNCATE rankings.generations CASCADE',
      ]) {
        expect(await errorMessage(() => sql.unsafe(statement))).toContain(immutable)
      }

      // The retention setting alone grants nothing: TRUNCATE and UPDATE stay blocked even for the owner.
      for (const statement of [
        'TRUNCATE rankings.snapshot_rows',
        `UPDATE rankings.snapshot_rows SET rating = rating + 1 WHERE snapshot_id = '${old.snapshots.all}'`,
        `UPDATE rankings.generations SET observed_at = observed_at WHERE id = '${old.generationId}'`,
      ]) {
        expect(
          await errorMessage(() =>
            sql.begin(async (transaction) => {
              await transaction`SELECT set_config('rankings.retention_delete', 'on', true)`
              await transaction.unsafe(statement)
            }),
          ),
        ).toContain(immutable)
      }

      // The retention function re-closes the deletion path before it returns.
      expect(
        await errorMessage(() =>
          sql.begin(async (transaction) => {
            await transaction`SELECT rankings.expire_v1_generations(clock_timestamp() - interval '24 hours', 10)`
            await transaction.unsafe(`DELETE FROM rankings.snapshot_rows WHERE snapshot_id = '${recent.snapshots.EU}'`)
          }),
        ),
      ).toContain(immutable)
      expect(await storedGenerationIds(sql)).toContain(old.generationId)
      expect(await orphanCounts(sql, [recent.generationId])).toEqual({ snapshots: 2, rows: 4 })
    } finally {
      await sql.end()
    }
  }, 30_000)

  test('lets the runtime role expire generations only through the definer function', async () => {
    const { sql } = await migratedDatabase()
    try {
      const now = await databaseNow(sql)
      const old = await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * hour) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 2 * hour) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 1 * hour) })
      // Production default privileges give the runtime role DML on every owner-created table.
      await sql.unsafe(`GRANT USAGE ON SCHEMA rankings TO ${runtimeRole}`)
      await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rankings TO ${runtimeRole}`)

      const [definition] = await sql<{ security_definer: boolean; config: string[] | null }[]>`
        SELECT prosecdef AS security_definer, proconfig AS config
        FROM pg_proc
        WHERE oid = 'rankings.expire_v1_generations(timestamptz, integer)'::regprocedure
      `
      expect(definition?.security_definer).toBe(true)
      expect(definition?.config).toContain('search_path=pg_catalog, pg_temp')
      // The trigger helper runs inside the definer function's deletes, so it pins its own search_path too.
      const [helper] = await sql<{ config: string[] | null }[]>`
        SELECT proconfig AS config
        FROM pg_proc
        WHERE oid = 'rankings.retention_delete_authorized(oid)'::regprocedure
      `
      expect(helper?.config).toContain('search_path=pg_catalog, pg_temp')
      const [privileges] = await sql<{ runtime: boolean; public: boolean }[]>`
        SELECT
          has_function_privilege(${runtimeRole}, 'rankings.expire_v1_generations(timestamptz, integer)', 'EXECUTE')
            AS runtime,
          EXISTS (
            SELECT 1
            FROM pg_proc, aclexplode(coalesce(proacl, acldefault('f', proowner))) acl
            WHERE oid = 'rankings.expire_v1_generations(timestamptz, integer)'::regprocedure
              AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
          ) AS public
      `
      expect(privileges).toEqual({ runtime: true, public: false })

      const asRuntime = async <T>(work: (transaction: postgres.TransactionSql) => Promise<T>) =>
        sql.begin(async (transaction) => {
          await transaction.unsafe(`SET LOCAL ROLE ${runtimeRole}`)
          return work(transaction)
        })

      // A runtime session cannot forge the retention setting to delete directly.
      expect(
        await errorMessage(() =>
          asRuntime(async (transaction) => {
            await transaction`SELECT set_config('rankings.retention_delete', 'on', true)`
            await transaction.unsafe(`DELETE FROM rankings.snapshot_rows WHERE snapshot_id = '${old.snapshots.all}'`)
          }),
        ),
      ).toContain('published ranking snapshots are immutable')

      const deleted = await asRuntime(async (transaction) => {
        const [row] = await transaction<{ deleted: number }[]>`
          SELECT rankings.expire_v1_generations(clock_timestamp() - interval '24 hours', 10) AS deleted
        `
        return row?.deleted
      })
      expect(deleted).toBe(1)
      expect(await storedGenerationIds(sql)).not.toContain(old.generationId)
    } finally {
      await sql.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA rankings FROM ${runtimeRole}`).catch(() => undefined)
      await sql.unsafe(`REVOKE ALL ON SCHEMA rankings FROM ${runtimeRole}`).catch(() => undefined)
      await sql.end()
    }
  }, 30_000)

  test('serves snapshot_not_found for expired pins while current leaderboard and activity keep working', async () => {
    const { sql, url } = await migratedDatabase()
    const ranking = createPostgresRanking(url)
    try {
      const now = await databaseNow(sql)
      const expiredGeneration = await insertGeneration(sql, {
        mode: '1v1',
        windowAt: new Date(now.getTime() - 30 * hour),
        wins: 1,
      })
      const partner = await insertGeneration(sql, {
        mode: '1v1',
        windowAt: new Date(now.getTime() - 75 * minute),
        wins: 10,
      })
      const current = await insertGeneration(sql, {
        mode: '1v1',
        windowAt: new Date(now.getTime() - 15 * minute),
        wins: 13,
      })

      const pinned = await ranking.queries.getLeaderboard({
        mode: '1v1',
        region: 'all',
        page: 1,
        snapshotId: expiredGeneration.snapshots.all,
      })
      expect(pinned.status).not.toBe('unavailable')

      expect(await expire(sql, new Date(now.getTime() - 24 * hour), 100)).toBe(1)

      expect(
        await ranking.queries.getLeaderboard({
          mode: '1v1',
          region: 'all',
          page: 1,
          snapshotId: expiredGeneration.snapshots.all,
        }),
      ).toMatchObject({ status: 'unavailable', reason: 'snapshot_not_found' })
      const latest = await ranking.queries.getLeaderboard({ mode: '1v1', region: 'all', page: 1, now })
      expect(latest).toMatchObject({ snapshotId: current.snapshots.all, generationId: current.generationId })

      const activity = await ranking.queries.getRecentActivity({ mode: '1v1', region: 'all', page: 1, now })
      if (activity.status === 'unavailable') throw new Error(`Expected recent activity, got ${activity.reason}`)
      expect(activity.currentSnapshotId).toBe(current.snapshots.all)
      expect(activity.previousObservedAt).toBe(new Date(now.getTime() - 75 * minute + 1_000).toISOString())
      expect(activity.entries.map(({ gamesDelta }) => gamesDelta)).toEqual([3, 3])
      expect(partner.generationId).toBeDefined()
    } finally {
      await ranking.close()
      await sql.end()
    }
  }, 30_000)

  test('runs the scheduled maintenance operation lease-fenced and records what it expired', async () => {
    const { sql, url } = await migratedDatabase()
    const operations = createPostgresRefreshOperations(url)
    const ranking = createPostgresRanking(url)
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'worker', sink, drainIntervalMs: 0 })
    try {
      const now = await databaseNow(sql)
      const expiredGenerations = [
        await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * hour) }),
        await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 29 * hour) }),
        await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 28 * hour) }),
      ]
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * minute) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 15 * minute) })

      const config = readOperationsWorkerConfig({ RANKING_RETENTION_BATCH: '2' }).rankingRetention
      const schedule = await operations.reconcileRankingRetentionSchedule(rankingRetentionScheduleDefinition(config))
      expect(schedule.outcome).toBe('created')
      expect(
        (await operations.reconcileRankingRetentionSchedule(rankingRetentionScheduleDefinition(config))).outcome,
      ).toBe('already-exists')
      const materialized = await operations.materializeDueSchedules()
      expect(materialized.occurrences).toEqual([
        expect.objectContaining({
          scheduleId: schedule.scheduleId,
          kind: 'ranking-retention',
          workClass: 'maintenance',
        }),
      ])

      // A stale lease cannot expire anything: the delete commits only with the lease row locked and current.
      const lease = await operations.claim('retention-worker', 30_000, admission, 'ranking-retention')
      if (!lease || lease.kind !== 'ranking-retention') throw new Error('Expected a ranking retention lease')
      expect(lease.payload).toEqual({ retentionHours: 24, maxGenerations: 2 })
      expect(
        await ranking.expireGenerations(
          { operationId: lease.operationId, leaseOwner: lease.leaseOwner, leaseToken: lease.leaseToken + 1 },
          lease.payload,
        ),
      ).toEqual({ outcome: 'lease-lost' })
      expect(await storedGenerationIds(sql)).toContain(expiredGenerations[0]?.generationId)
      // Completion is only possible from the transaction that locked the current lease row.
      expect(
        await errorMessage(
          () => sql`
            SELECT refresh_operations.complete_ranking_retention_lease(
              ${lease.operationId}, ${lease.leaseOwner}, ${lease.leaseToken}
            )
          `,
        ),
      ).toContain('ranking retention lease row is not locked by this transaction')
      expect(await operations.operationStatus(lease.operationId)).toBe('leased')
      await sql`
        UPDATE refresh_operations.operations SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${lease.operationId}
      `

      expect(
        await runOneRefreshOperation(operations, 'retention-worker', {
          leaseMs: 30_000,
          retryDelayMs: 1_000,
          admission,
          rankingRetention: ranking,
          telemetry,
        }),
      ).toBe(true)
      const remaining = await storedGenerationIds(sql)
      expect(remaining).not.toContain(expiredGenerations[0]?.generationId)
      expect(remaining).not.toContain(expiredGenerations[1]?.generationId)
      expect(remaining).toContain(expiredGenerations[2]?.generationId)
      expect(await operations.operationStatus(lease.operationId)).toBe('succeeded')

      await telemetry.flush(50)
      const counter = telemetry.metrics
        .snapshot()
        .find(({ name }) => name === 'ranking_retention_deleted_generations_total')
      expect(counter?.series).toEqual([expect.objectContaining({ labels: {}, value: 2 })])
      expect(sink.records.find(({ event }) => event === 'ranking.retention.completed')?.attributes).toMatchObject({
        operationId: lease.operationId,
        deletedGenerations: 2,
        retentionHours: 24,
        maxGenerations: 2,
        batchFull: true,
      })
    } finally {
      await telemetry.shutdown(50)
      await ranking.close()
      await operations.close()
      await sql.end()
    }
  }, 30_000)

  test('pauses the schedule and completes leftover runs as no-ops when retention is disabled', async () => {
    const { sql, url } = await migratedDatabase()
    const operations = createPostgresRefreshOperations(url)
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'worker', sink, drainIntervalMs: 0 })
    try {
      const now = await databaseNow(sql)
      const old = await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * hour) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * minute) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 15 * minute) })
      const definition = rankingRetentionScheduleDefinition(readOperationsWorkerConfig({}).rankingRetention)
      expect(await operations.disableRankingRetentionSchedule(definition.scheduleKey)).toEqual({ outcome: 'absent' })
      const schedule = await operations.reconcileRankingRetentionSchedule(definition)
      expect((await operations.materializeDueSchedules()).occurrences).toHaveLength(1)

      expect(await operations.disableRankingRetentionSchedule(definition.scheduleKey)).toEqual({
        outcome: 'disabled',
      })
      expect(await operations.disableRankingRetentionSchedule(definition.scheduleKey)).toEqual({
        outcome: 'already-disabled',
      })
      await sql`
        UPDATE refresh_operations.schedules SET next_due_at = clock_timestamp() - interval '1 hour'
        WHERE id = ${schedule.scheduleId}
      `
      expect((await operations.materializeDueSchedules()).occurrences).toEqual([])

      // The run materialized before the switch flipped completes without touching the retention function.
      const untouchable = {
        expireGenerations: async () => {
          throw new Error('ranking retention must not run while disabled')
        },
      }
      expect(
        await runOneRefreshOperation(operations, 'retention-worker', {
          leaseMs: 30_000,
          retryDelayMs: 1_000,
          admission,
          rankingRetention: untouchable,
          rankingRetentionEnabled: false,
          telemetry,
        }),
      ).toBe(true)
      const [operation] = await sql<{ id: string; status: string }[]>`
        SELECT id, status FROM refresh_operations.operations WHERE kind = 'ranking-retention'
      `
      expect(operation?.status).toBe('succeeded')
      expect(await storedGenerationIds(sql)).toContain(old.generationId)
      await telemetry.flush(50)
      expect(sink.records.find(({ event }) => event === 'ranking.retention.skipped')?.attributes).toMatchObject({
        operationId: operation?.id,
        reason: 'disabled',
        deletedGenerations: 0,
      })

      // Turning retention back on re-enables the same schedule.
      expect((await operations.reconcileRankingRetentionSchedule(definition)).outcome).toBe('reconciled')
      const [enabled] = await sql<{ enabled: boolean }[]>`
        SELECT enabled FROM refresh_operations.schedules WHERE id = ${schedule.scheduleId}
      `
      expect(enabled?.enabled).toBe(true)
      expect((await operations.materializeDueSchedules()).occurrences).toHaveLength(1)
    } finally {
      await telemetry.shutdown(50)
      await operations.close()
      await sql.end()
    }
  }, 30_000)

  test('completes a retention batch that outlives its lease together with the delete', async () => {
    const { sql, url } = await migratedDatabase()
    const operations = createPostgresRefreshOperations(url)
    const ranking = createPostgresRanking(url)
    try {
      const now = await databaseNow(sql)
      const old = [
        await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * hour) }),
        await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 29 * hour) }),
        await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 28 * hour) }),
      ]
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 30 * minute) })
      await insertGeneration(sql, { mode: '1v1', windowAt: new Date(now.getTime() - 15 * minute) })
      const config = readOperationsWorkerConfig({ RANKING_RETENTION_BATCH: '2' }).rankingRetention
      await operations.reconcileRankingRetentionSchedule(rankingRetentionScheduleDefinition(config))
      await operations.materializeDueSchedules()

      // A reader holding SHARE on snapshot_rows stalls the delete for longer than the 300ms lease.
      const leaseMs = 300
      let release: () => void = () => undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let locked: () => void = () => undefined
      const tableLocked = new Promise<void>((resolve) => {
        locked = resolve
      })
      const blocker = sql.begin(async (transaction) => {
        await transaction`LOCK TABLE rankings.snapshot_rows IN SHARE MODE`
        locked()
        await held
      })
      await tableLocked
      const run = runOneRefreshOperation(operations, 'retention-worker', {
        leaseMs,
        retryDelayMs: 1_000,
        admission,
        rankingRetention: ranking,
      })
      await Bun.sleep(4 * leaseMs)
      release()
      await blocker
      expect(await run).toBe(true)

      const [operation] = await sql<{ id: string; status: string }[]>`
        SELECT id, status FROM refresh_operations.operations WHERE kind = 'ranking-retention'
      `
      expect(operation?.status).toBe('succeeded')
      const attempts = await sql<{ outcome: string | null }[]>`
        SELECT outcome FROM refresh_operations.attempts WHERE operation_id = ${operation?.id as string}
      `
      expect(attempts).toEqual([{ outcome: 'succeeded' }])
      // Nothing is left to reclaim, so the batch is not re-run back to back.
      expect(await operations.claim('retention-worker', leaseMs, admission, 'ranking-retention')).toBeNull()
      const remaining = await storedGenerationIds(sql)
      expect(remaining).not.toContain(old[0]?.generationId)
      expect(remaining).not.toContain(old[1]?.generationId)
      expect(remaining).toContain(old[2]?.generationId)
    } finally {
      await ranking.close()
      await operations.close()
      await sql.end()
    }
  }, 30_000)

  test('rejects ranking retention payloads outside the safe bounds before and inside the database', async () => {
    const { sql, url } = await migratedDatabase()
    const operations = createPostgresRefreshOperations(url)
    try {
      const definition = rankingRetentionScheduleDefinition(readOperationsWorkerConfig({}).rankingRetention)
      await expect(
        operations.reconcileRankingRetentionSchedule({
          ...definition,
          payload: { retentionHours: 23, maxGenerations: 20 },
        }),
      ).rejects.toThrow('ranking retention retentionHours must be an integer between 24 and 8760')
      await expect(
        operations.reconcileRankingRetentionSchedule({
          ...definition,
          payload: { retentionHours: 24, maxGenerations: 201 },
        }),
      ).rejects.toThrow('ranking retention maxGenerations must be an integer between 1 and 200')
      for (const payload of [
        { retentionHours: 23, maxGenerations: 20 },
        { retentionHours: 24, maxGenerations: 0 },
        { retentionHours: 24, maxGenerations: 201 },
        { retentionHours: 24, maxGenerations: 20, extra: true },
      ]) {
        expect(
          await errorMessage(
            () => sql`
              INSERT INTO refresh_operations.schedules
                (id, schedule_key, kind, work_class, interval_ms, first_due_at, next_due_at, operation_key_prefix,
                 payload, provenance, max_attempts)
              VALUES
                (${randomUUID()}, ${`retention-check:${randomUUID()}`}, 'ranking-retention', 'maintenance', 900000,
                 now(), now(), 'retention-check', ${sql.json(payload)}, ${sql.json({ source: 'test' })}, 3)
            `,
          ),
        ).toContain('schedules_payload_by_kind')
        const operationId = randomUUID()
        expect(
          await errorMessage(
            () => sql`
              INSERT INTO refresh_operations.operations
                (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
                 max_attempts)
              VALUES
                (${operationId}, ${operationId}, 'ranking-retention', ${randomUUID()}, ${randomUUID()}, 'maintenance',
                 ${sql.json(payload)}, ${sql.json({ source: 'test' })}, 3)
            `,
          ),
        ).toContain('operations_payload_by_kind')
      }
    } finally {
      await operations.close()
      await sql.end()
    }
  }, 30_000)
})
