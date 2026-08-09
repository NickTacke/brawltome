import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { type RegionalLeaderboardScope, regionalLeaderboardScopes } from '@brawltome/ranking'
import {
  type LeaderboardGenerationCandidate,
  type RankingPublicationAuthorization,
  collectAndPublish1v1Generation,
  createPostgresRanking,
  rankingMigrationInventory,
} from '@brawltome/ranking/composition'
import type { OperationLease } from '@brawltome/refresh-operations'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { runOneDurableOperation } from '../src/refresh-operations-worker'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_rankings_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

const intervalMs = 15 * 60 * 1000
const admission = {
  totalConcurrency: 8,
  interactiveReservation: 2,
  classConcurrency: {
    interactive: 4,
    'primary-monitoring': 2,
    leaderboard: 4,
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

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Ranking PostgreSQL tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of [...refreshOperationsMigrationInventory, ...rankingMigrationInventory]) {
      await setup.unsafe(migration.sql)
    }
  } finally {
    await setup.end()
  }
})

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

function authorization(
  lease: OperationLease,
  scheduleWindowAt = lease.scheduleWindowAt,
): RankingPublicationAuthorization {
  return {
    operationId: lease.operationId,
    operationKey: lease.operationKey,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    scheduleWindowAt,
  }
}

function sourceRow(region: RegionalLeaderboardScope, index: number, variant = 0) {
  const regionIndex = regionalLeaderboardScopes.indexOf(region)
  return {
    id: variant * 100_000 + regionIndex * 1_000 + index + 1,
    username: `${region} Player ${variant}-${index}`,
    rating: 2400 - index - regionIndex,
    best_rating: 2450 - index - regionIndex,
    rank: index + 1,
    wins: 20,
    losses: 10,
    region,
    tier: 'Diamond',
  }
}

function candidate(
  operationKey: string,
  scheduleWindowAt = new Date('2026-08-09T12:00:00Z'),
  rowsPerRegion = 1,
  variant = 0,
): LeaderboardGenerationCandidate {
  const regional = new Map(
    regionalLeaderboardScopes.map((region) => [
      region,
      Array.from({ length: rowsPerRegion }, (_, index) => {
        const row = sourceRow(region, index, variant)
        return {
          standing: row.rank,
          sourceRank: row.rank,
          brawlhallaId: row.id,
          name: row.username,
          region,
          rating: row.rating,
          peakRating: row.best_rating,
          wins: row.wins,
          losses: row.losses,
          tier: row.tier,
        }
      }),
    ]),
  )
  const global = [...regional.values()]
    .flat()
    .sort((left, right) => right.rating - left.rating || left.brawlhallaId - right.brawlhallaId)
    .map((row, index) => ({ ...row, standing: index + 1 }))
  return {
    operationKey,
    observedAt: new Date(scheduleWindowAt.getTime() + 1_000),
    scheduleWindowAt,
    expectedNextPublicationAt: new Date(scheduleWindowAt.getTime() + intervalMs),
    pageDepth: 1,
    snapshots: new Map([...regional, ['all' as const, global]]),
  }
}

async function leaseOperation(
  operations: ReturnType<typeof createPostgresRefreshOperations>,
  label: string,
  options: { operationKey?: string; maxAttempts?: number } = {},
) {
  const accepted = await operations.accept({
    kind: 'leaderboard-1v1',
    dedupeKey: `ranking:${label}:${randomUUID()}`,
    operationKey: options.operationKey ?? `ranking-effect:${label}:${randomUUID()}`,
    workClass: 'leaderboard',
    payload: { pageDepth: 1, intervalMs },
    provenance: { source: 'ranking-postgres-test' },
    maxAttempts: options.maxAttempts,
  })
  const lease = await operations.claim(`worker:${label}`, 10_000, admission)
  if (!lease || lease.operationId !== accepted.operationId || lease.kind !== 'leaderboard-1v1') {
    throw new Error('Expected Ranking operation lease')
  }
  return lease
}

async function expire(operationId: string) {
  const control = postgres(connectionString, { max: 1 })
  try {
    await control`
      UPDATE refresh_operations.operations
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${operationId}
    `
  } finally {
    await control.end()
  }
}

function validSource(variant = 0, rows = 1) {
  return {
    async fetchPage({ region }: { region: RegionalLeaderboardScope; page: number }) {
      return {
        rankings: Array.from({ length: rows }, (_, index) => sourceRow(region, index, variant)),
        totalPages: 1,
      }
    },
  }
}

describe('immutable Ranking snapshots', () => {
  test('validates leaderboard payload semantics before and inside PostgreSQL', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const base = {
      kind: 'leaderboard-1v1' as const,
      dedupeKey: `invalid:${randomUUID()}`,
      operationKey: `invalid:${randomUUID()}`,
      workClass: 'leaderboard' as const,
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'ranking-postgres-test' },
    }
    await expect(operations.accept({ ...base, payload: { ...base.payload, pageDepth: 1.5 } })).rejects.toThrow(
      'pageDepth',
    )
    await expect(operations.accept({ ...base, payload: { ...base.payload, intervalMs: 59_999 } })).rejects.toThrow(
      'intervalMs',
    )
    await expect(
      operations.createSchedule({
        ...base,
        scheduleKey: `invalid:${randomUUID()}`,
        operationKeyPrefix: 'invalid',
        intervalMs,
        firstDueAt: new Date().toISOString(),
        payload: { pageDepth: 1, intervalMs: intervalMs * 2 },
      }),
    ).rejects.toThrow('match')

    const control = postgres(connectionString, { max: 1 })
    let constraintError: unknown
    try {
      await control`
        INSERT INTO refresh_operations.operations
          (id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
        VALUES
          (${randomUUID()}, 'leaderboard-1v1', ${randomUUID()}, ${randomUUID()}, 'maintenance',
           ${control.json({ pageDepth: 0, intervalMs: 1.5 })}, ${control.json({ source: 'test' })}, 1)
      `
    } catch (error) {
      constraintError = error
    }
    expect(constraintError).toBeInstanceOf(Error)
    expect((constraintError as { code?: string }).code).toBe('23514')
    await control.end()
  })

  test('reconciles fixed-interval schedule config while preserving history and last coalesced window on restart', async () => {
    const first = createPostgresRefreshOperations(connectionString)
    const second = createPostgresRefreshOperations(connectionString)
    const scheduleKey = `ranking-schedule:${randomUUID()}`
    const firstDueAt = new Date(Date.now() - 5 * intervalMs).toISOString()
    const definition = {
      kind: 'leaderboard-1v1' as const,
      scheduleKey,
      operationKeyPrefix: 'rankings:1v1:test',
      workClass: 'leaderboard' as const,
      intervalMs,
      firstDueAt,
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'ranking-postgres-test', requestedBy: 'issue-201' },
    }
    const concurrent = await Promise.all([
      first.reconcileLeaderboardSchedule(definition),
      second.reconcileLeaderboardSchedule(definition),
    ])
    const created = concurrent.find(({ outcome }) => outcome === 'created')
    if (!created) throw new Error('Expected one schedule creator')
    expect(new Set(concurrent.map(({ scheduleId }) => scheduleId))).toEqual(new Set([created.scheduleId]))
    expect(concurrent.map(({ outcome }) => outcome).sort()).toEqual(['already-exists', 'created'])
    expect(
      (await Promise.all([first.materializeDueSchedules(1), second.materializeDueSchedules(1)])).reduce(
        (total, result) => total + result.occurrencesCreated,
        0,
      ),
    ).toBe(1)
    const lease = await first.claim('scheduled-worker', 10_000, admission)
    if (!lease || lease.kind !== 'leaderboard-1v1') throw new Error('Expected scheduled leaderboard lease')
    expect(lease.scheduleWindowAt).toBe(new Date(new Date(firstDueAt).getTime() + 5 * intervalMs).toISOString())
    expect(await first.complete(lease)).toBe('transitioned')

    const changed = { ...definition, intervalMs: 30 * 60 * 1000, payload: { pageDepth: 2, intervalMs: 30 * 60 * 1000 } }
    const reconciled = await first.reconcileLeaderboardSchedule(changed)
    expect(reconciled.outcome).toBe('reconciled')
    expect((await first.inspectSchedule(created.scheduleId)).occurrences).toHaveLength(1)
    expect((await first.inspectSchedule(created.scheduleId)).schedule.enabled).toBe(false)
    await Promise.all([first.close(), second.close()])

    const restarted = createPostgresRefreshOperations(connectionString)
    expect(await restarted.reconcileLeaderboardSchedule(changed)).toEqual({
      outcome: 'already-exists',
      scheduleId: reconciled.scheduleId,
    })
    await restarted.close()
  })

  test('publishes one whole generation, preserves source rank, and serves same-generation Global after restart', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const lease = await leaseOperation(operations, 'whole-generation')
    const calls: Array<{ region: RegionalLeaderboardScope; page: number }> = []
    expect(
      await collectAndPublish1v1Generation({
        authorization: authorization(lease),
        source: {
          async fetchPage(input) {
            calls.push(input)
            return validSource().fetchPage(input)
          },
        },
        publication: ranking,
        clock: () => new Date('2026-08-09T12:00:01Z'),
      }),
    ).toBe('published')
    expect(calls).toEqual(regionalLeaderboardScopes.map((region) => ({ region, page: 1 })))
    expect(await operations.complete(lease)).toBe('transitioned')

    const eu = await ranking.queries.get1v1({ region: 'EU', page: 1, now: new Date('2026-08-09T12:01:00Z') })
    const global = await ranking.queries.get1v1({ region: 'all', page: 1, now: new Date('2026-08-09T12:01:00Z') })
    if (eu.status === 'unavailable' || global.status === 'unavailable') throw new Error('Expected snapshots')
    expect(eu.entries[0]).toMatchObject({ standing: 1, sourceRank: 1, region: 'EU' })
    expect(global).toMatchObject({ totalRows: 9 })
    expect(eu.generationId).toBe(global.generationId)
    const control = postgres(connectionString, { max: 1 })
    let immutableError: unknown
    try {
      await control`UPDATE rankings.snapshot_rows SET rating = rating + 1 WHERE snapshot_id = ${eu.snapshotId}`
    } catch (error) {
      immutableError = error
    }
    expect(immutableError).toBeInstanceOf(Error)
    expect((immutableError as Error).message).toContain('published ranking snapshots are immutable')
    await control.end()
    await ranking.close()

    const restarted = createPostgresRanking(connectionString)
    expect(await restarted.queries.get1v1({ region: 'all', page: 1, now: new Date('2026-08-09T12:01:00Z') })).toEqual(
      global,
    )
    await restarted.close()
    await operations.close()
  })

  test('recovers a final-attempt crash after atomic publication and rejects operation-key reuse', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const crashed = await leaseOperation(operations, 'crash', { maxAttempts: 1 })
    expect(await ranking.publish1v1Generation(authorization(crashed), candidate(crashed.operationKey))).toBe(
      'published',
    )
    await expire(crashed.operationId)
    expect(await operations.claim('recovery-worker', 10_000, admission)).toBeNull()
    const recovered = await operations.inspect(crashed.operationId)
    expect(recovered.operation.status).toBe('succeeded')
    expect(recovered.leaderboardEffects).toHaveLength(1)
    expect(recovered.attempts.map(({ outcome }) => outcome)).toEqual(['succeeded'])

    const conflicting = await operations.accept({
      kind: 'leaderboard-1v1',
      dedupeKey: `conflict:${randomUUID()}`,
      operationKey: crashed.operationKey,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'ranking-postgres-test' },
    })
    expect(
      await runOneDurableOperation(operations, 'conflict-worker', {
        leaseMs: 10_000,
        retryDelayMs: 0,
        admission,
        ranking,
        leaderboardSource: validSource(3),
      }),
    ).toBe(true)
    expect((await operations.inspect(conflicting.operationId)).operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'leaderboard_effect_conflict', retryable: false },
    })
    await ranking.close()
    await operations.close()
  })

  test('serializes concurrent authorized operations that reuse one operation key', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const operationKey = `shared-effect:${randomUUID()}`
    const first = await leaseOperation(operations, 'shared-key-first', { operationKey })
    const second = await leaseOperation(operations, 'shared-key-second', { operationKey })

    const results = await Promise.all([
      ranking.publish1v1Generation(authorization(first), candidate(operationKey, new Date(), 1, 10)),
      ranking.publish1v1Generation(authorization(second), candidate(operationKey, new Date(), 1, 11)),
    ])
    expect([...results].sort()).toEqual(['effect-conflict', 'published'])

    for (const [lease, result] of [
      [first, results[0]],
      [second, results[1]],
    ] as const) {
      if (result === 'published') await operations.complete(lease)
      else {
        await operations.fail(
          lease,
          { code: 'leaderboard_effect_conflict', message: 'shared operation key', retryable: false },
          0,
        )
      }
    }
    await ranking.close()
    await operations.close()
  })

  test('rolls back the effect and every inserted scope when the final regional row violates storage constraints', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const lease = await leaseOperation(operations, 'late-rollback')
    const malformed = candidate(lease.operationKey)
    const saRows = malformed.snapshots.get('SA')
    if (!saRows) throw new Error('Expected SA rows')
    malformed.snapshots = new Map(malformed.snapshots).set('SA', [{ ...saRows[0], rating: -1 }])
    await expect(ranking.publish1v1Generation(authorization(lease), malformed)).rejects.toThrow()

    const control = postgres(connectionString, { max: 1 })
    const [counts] = await control<{ generations: number; snapshots: number; rows: number; effects: number }[]>`
      SELECT
        (SELECT count(*)::int FROM rankings.generations WHERE operation_id = ${lease.operationId}) AS generations,
        (SELECT count(*)::int FROM rankings.snapshots snapshot
          JOIN rankings.generations generation ON generation.id = snapshot.generation_id
          WHERE generation.operation_id = ${lease.operationId}) AS snapshots,
        (SELECT count(*)::int FROM rankings.snapshot_rows row
          JOIN rankings.snapshots snapshot ON snapshot.id = row.snapshot_id
          JOIN rankings.generations generation ON generation.id = snapshot.generation_id
          WHERE generation.operation_id = ${lease.operationId}) AS rows,
        (SELECT count(*)::int FROM refresh_operations.leaderboard_effects
          WHERE operation_id = ${lease.operationId}) AS effects
    `
    expect(counts).toEqual({ generations: 0, snapshots: 0, rows: 0, effects: 0 })
    await control.end()
    await operations.fail(
      lease,
      { code: 'storage_invalid', message: 'deliberate constraint failure', retryable: false },
      0,
    )
    await ranking.close()
    await operations.close()
  })

  test('retains its own valid baseline as stale through retry and dead-letter collection failures', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const baseline = await leaseOperation(operations, 'stale-baseline')
    const baselineWindow = new Date(Date.now() - 1_000)
    expect(
      await ranking.publish1v1Generation(
        authorization(baseline, baselineWindow.toISOString()),
        candidate(baseline.operationKey, baselineWindow, 1, 4),
      ),
    ).toBe('published')
    await operations.complete(baseline)

    const failed = await operations.accept({
      kind: 'leaderboard-1v1',
      dedupeKey: `failure:${randomUUID()}`,
      operationKey: `failure:${randomUUID()}`,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'ranking-postgres-test' },
      maxAttempts: 2,
    })
    const options = {
      leaseMs: 10_000,
      retryDelayMs: 0,
      admission,
      ranking,
      leaderboardSource: {
        async fetchPage() {
          throw Object.assign(new Error('deliberate upstream outage'), {
            code: 'source_unavailable',
            retryable: true,
          })
        },
      },
    }
    expect(await runOneDurableOperation(operations, 'failure-worker-1', options)).toBe(true)
    expect((await operations.inspect(failed.operationId)).operation.status).toBe('pending')
    expect(await runOneDurableOperation(operations, 'failure-worker-2', options)).toBe(true)
    const failureState = await operations.inspect(failed.operationId)
    expect(failureState.operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'source_unavailable', retryable: true },
    })
    expect(failureState.attempts.map(({ outcome }) => outcome)).toEqual(['retry', 'dead_letter'])

    const retained = await ranking.queries.get1v1({ region: 'all', page: 1, now: new Date() })
    expect(retained.status).toBe('stale')
    if (retained.status === 'unavailable') throw new Error('Expected retained snapshot')
    expect(retained.entries.length).toBeGreaterThan(0)
    await ranking.close()
    await operations.close()
  })

  test('orders publication by fixed schedule window so a delayed older generation cannot supersede newer standings', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const older = await leaseOperation(operations, 'older-window')
    const newer = await leaseOperation(operations, 'newer-window')
    const olderWindow = new Date(Date.now() + 2 * intervalMs)
    const newerWindow = new Date(olderWindow.getTime() + intervalMs)
    expect(
      await ranking.publish1v1Generation(
        authorization(newer, newerWindow.toISOString()),
        candidate(newer.operationKey, newerWindow, 1, 6),
      ),
    ).toBe('published')
    expect(
      await ranking.publish1v1Generation(
        authorization(older, olderWindow.toISOString()),
        candidate(older.operationKey, olderWindow, 1, 7),
      ),
    ).toBe('published')
    await operations.complete(newer)
    await operations.complete(older)
    const latest = await ranking.queries.get1v1({ region: 'all', page: 1, now: newerWindow })
    if (latest.status === 'unavailable') throw new Error('Expected latest snapshot')
    expect(latest.entries[0].name).toContain('6-')
    await ranking.close()
    await operations.close()
  })

  test('pins later pages to one immutable snapshot while unpinned reads advance to a newer generation', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const first = await leaseOperation(operations, 'pagination-first')
    const firstWindow = new Date(Date.now() + 4 * intervalMs)
    await ranking.publish1v1Generation(
      authorization(first, firstWindow.toISOString()),
      candidate(first.operationKey, firstWindow, 60, 8),
    )
    await operations.complete(first)
    const pageOne = await ranking.queries.get1v1({ region: 'all', page: 1, pageSize: 10, now: firstWindow })
    if (pageOne.status === 'unavailable') throw new Error('Expected first snapshot')

    const second = await leaseOperation(operations, 'pagination-second')
    const secondWindow = new Date(firstWindow.getTime() + intervalMs)
    await ranking.publish1v1Generation(
      authorization(second, secondWindow.toISOString()),
      candidate(second.operationKey, secondWindow, 60, 9),
    )
    await operations.complete(second)

    const pinned = await ranking.queries.get1v1({
      region: 'all',
      page: 2,
      pageSize: 10,
      snapshotId: pageOne.snapshotId,
      now: secondWindow,
    })
    const latest = await ranking.queries.get1v1({ region: 'all', page: 1, pageSize: 10, now: secondWindow })
    if (pinned.status === 'unavailable' || latest.status === 'unavailable') throw new Error('Expected snapshots')
    expect(pinned.generationId).toBe(pageOne.generationId)
    expect(pinned.entries.every(({ name }) => name.includes('8-'))).toBe(true)
    expect(latest.entries.every(({ name }) => name.includes('9-'))).toBe(true)
    expect(await ranking.queries.get1v1({ region: 'EU', page: 1, snapshotId: pageOne.snapshotId })).toMatchObject({
      status: 'unavailable',
      reason: 'snapshot_not_found',
    })
    await ranking.close()
    await operations.close()
  })
})
