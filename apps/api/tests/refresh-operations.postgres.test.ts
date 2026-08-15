import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { OperationLease } from '@brawltome/refresh-operations'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { createPostgresReadiness } from '../src/postgres-readiness'
import { SourceAdmissionLimitedError, runOneRefreshOperation } from '../src/refresh-operations-worker'
import { createRefreshOperationRoutes } from '../src/routes/refresh-operations.routes'
import { runtimeMigrationInventory } from '../src/runtime-migration-inventory'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_operations_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

const testAdmission = {
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

function requireLease(lease: OperationLease | null): OperationLease
function requireLease<K extends OperationLease['kind']>(
  lease: OperationLease | null,
  expectedKind: K,
): Extract<OperationLease, { kind: K }>
function requireLease(lease: OperationLease | null, expectedKind?: OperationLease['kind']): OperationLease {
  if (!lease) throw new Error('Expected an operation lease')
  if (expectedKind && lease.kind !== expectedKind) throw new Error(`Expected a ${expectedKind} lease`)
  return lease
}

async function settleWithin<T>(label: string, promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Refresh Operations integration tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of refreshOperationsMigrationInventory) await setup.unsafe(migration.sql)
    await setup.unsafe(`
      CREATE SCHEMA brawltome_migrations;
      CREATE TABLE brawltome_migrations.history (
        ordinal integer PRIMARY KEY,
        identity text NOT NULL UNIQUE,
        checksum char(64) NOT NULL
      );
    `)
    for (const [ordinal, migration] of refreshOperationsMigrationInventory.entries()) {
      await setup`
        INSERT INTO brawltome_migrations.history (ordinal, identity, checksum)
        VALUES (${ordinal}, ${migration.identity}, ${migration.checksum})
      `
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

describe('durable Refresh Operations', () => {
  test('preserves the deployed runtime prefix and appends later migrations in dependency order', () => {
    expect(runtimeMigrationInventory.map(({ identity }): string => identity)).toEqual([
      'players/0001',
      'players/0002',
      'players/0003',
      'refresh-operations/0001',
      'refresh-operations/0002',
      'refresh-operations/0003',
      'refresh-operations/0004',
      'refresh-operations/0005',
      'refresh-operations/0006',
      'request-admission/0001',
      'request-admission/0002',
      'accounts/0001',
      'accounts/0002',
      'rankings/0001',
      'clans/0001',
      'refresh-operations/0007',
      'refresh-operations/0008',
      'accounts/0003',
      'refresh-operations/0009',
      'rankings/0002',
      'players/0004',
      'players/0005',
      'refresh-operations/0010',
      'discovery/0001',
      'accounts/0004',
      'players/0006',
      'refresh-operations/0011',
      'refresh-operations/0012',
      'clans/0002',
      'discovery/0002',
      'refresh-operations/0013',
      'statistics/0001',
      'refresh-operations/0014',
      'accounts/0005',
      'players/0007',
      'statistics/0002',
      'refresh-operations/0015',
      'clans/0003',
      'rankings/0003',
      'accounts/0006',
      'statistics/0003',
      'refresh-operations/0016',
      'statistics/0004',
      'request-admission/0003',
      'discovery/0003',
      'accounts/0007',
      'rankings/0004',
      'rankings/0005',
      'players/0008',
      'rankings/0006',
      'players/0009',
      'players/0010',
      'clans/0004',
      'players/0011',
      'players/0012',
    ])
  })

  test('reports bounded authoritative oldest-job, schedule-lateness, and dead-letter gauges', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const control = postgres(connectionString, { max: 1 })
    try {
      const pending = await operations.accept({
        dedupeKey: `telemetry-pending:${randomUUID()}`,
        operationKey: `telemetry-pending:${randomUUID()}`,
        workClass: 'maintenance',
        payload: { value: 'pending' },
        provenance: { source: 'telemetry-test' },
      })
      const dead = await operations.accept({
        dedupeKey: `telemetry-dead:${randomUUID()}`,
        operationKey: `telemetry-dead:${randomUUID()}`,
        workClass: 'projection',
        payload: { value: 'dead' },
        provenance: { source: 'telemetry-test' },
        maxAttempts: 1,
      })
      await control`
        UPDATE refresh_operations.operations
        SET status = 'dead_letter', completed_at = clock_timestamp(),
            last_error = ${control.json({ code: 'test_failure', message: 'safe', retryable: false })}
        WHERE id = ${dead.operationId}
      `
      await operations.createSchedule({
        scheduleKey: `telemetry-schedule:${randomUUID()}`,
        operationKeyPrefix: `telemetry-schedule:${randomUUID()}`,
        workClass: 'maintenance',
        intervalMs: 60_000,
        firstDueAt: new Date(Date.now() - 2_000).toISOString(),
        payload: { value: 'schedule' },
        provenance: { source: 'telemetry-test' },
      })

      const snapshot = await operations.inspectTelemetry()
      expect(snapshot.oldestPending.find(({ workClass }) => workClass === 'maintenance')?.ageMs).toBeGreaterThanOrEqual(
        0,
      )
      const unresolvedDeadLetters = snapshot.deadLetters.find(
        ({ workClass, kind }) => workClass === 'projection' && kind === 'proof',
      )?.count
      expect(unresolvedDeadLetters).toBeGreaterThanOrEqual(1)
      expect(
        await operations.discardDeadLetter({
          operationId: dead.operationId,
          actorId: 'operator:telemetry-test',
          reason: 'verify resolved dead letters leave the active gauge',
        }),
      ).toMatchObject({ outcome: 'discarded' })
      const resolvedSnapshot = await operations.inspectTelemetry()
      expect(
        resolvedSnapshot.deadLetters.find(({ workClass, kind }) => workClass === 'projection' && kind === 'proof')
          ?.count,
      ).toBe((unresolvedDeadLetters ?? 1) - 1)
      expect(snapshot.scheduleLateness.find(({ kind }) => kind === 'proof')?.latenessMs).toBeGreaterThan(0)
      expect(snapshot.oldestPending).toHaveLength(6)
      expect(pending.operationId).toBeTruthy()
    } finally {
      await control`
        DELETE FROM refresh_operations.schedules
        WHERE provenance ->> 'source' = 'telemetry-test'
      `
      await control`
        DELETE FROM refresh_operations.operations
        WHERE provenance ->> 'source' = 'telemetry-test'
          AND status <> 'dead_letter'
      `
      await operations.close()
      await control.end()
    }
  })

  test('accepts a later same-owner migration while rejecting known history mutation', async () => {
    const readiness = createPostgresReadiness(connectionString, refreshOperationsMigrationInventory)
    await readiness.check()

    const control = postgres(connectionString, { max: 1 })
    const laterIdentity = `refresh-operations/rolling-overlap-${randomUUID()}`
    try {
      await control`
        INSERT INTO brawltome_migrations.history (ordinal, identity, checksum)
        SELECT COALESCE(MAX(ordinal), -1) + 1, ${laterIdentity}, ${'f'.repeat(64)}
        FROM brawltome_migrations.history
      `
      await readiness.check()
      await control`
        UPDATE brawltome_migrations.history
        SET checksum = ${'0'.repeat(64)}
        WHERE identity = ${refreshOperationsMigrationInventory[0].identity}
      `
      await expect(readiness.check()).rejects.toThrow('schema checksum mismatch')
      await control`
        UPDATE brawltome_migrations.history
        SET checksum = ${refreshOperationsMigrationInventory[0].checksum}
        WHERE identity = ${refreshOperationsMigrationInventory[0].identity}
      `
      await readiness.check()
    } finally {
      await control`
        UPDATE brawltome_migrations.history
        SET checksum = ${refreshOperationsMigrationInventory[0].checksum}
        WHERE identity = ${refreshOperationsMigrationInventory[0].identity}
      `
      await control`
        DELETE FROM brawltome_migrations.history
        WHERE identity = ${laterIdentity}
      `
      await control.end()
      await readiness.close()
    }
  })

  test('renews an active lease until its durable effect and completion commit', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const accepted = await operations.accept({
      dedupeKey: `renew:${randomUUID()}`,
      operationKey: `renew-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'renewed' },
      provenance: { source: 'integration-test', requestedBy: 'issue-214' },
    })

    await runOneRefreshOperation(operations, 'renewing-worker', {
      leaseMs: 1_000,
      renewEveryMs: 100,
      retryDelayMs: 1,
      admission: testAdmission,
      executeEffect: async (lease) => {
        await Bun.sleep(1_200)
        return operations.commitProofEffect(lease)
      },
    })

    const state = await operations.inspect(accepted.operationId)
    expect(state.operation.status).toBe('succeeded')
    expect(state.effects).toHaveLength(1)
    expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['succeeded'])
    await operations.close()
  })

  test('deduplicates acceptance, notifies, and reconciles a final-attempt crash after one effect', async () => {
    const producer = createPostgresRefreshOperations(connectionString)
    let notifiedOperationId = ''
    let resolveNotification: (() => void) | undefined
    const notification = new Promise<void>((resolve) => {
      resolveNotification = resolve
    })
    const listener = await producer.listen((operationId) => {
      notifiedOperationId = operationId
      resolveNotification?.()
    })
    const input = {
      dedupeKey: `proof:${randomUUID()}`,
      operationKey: `effect:${randomUUID()}`,
      workClass: 'interactive' as const,
      payload: { value: 'once' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      maxAttempts: 1,
    }
    const accepted = await Promise.all(Array.from({ length: 20 }, () => producer.accept(input)))
    expect(new Set(accepted.map(({ operationId }) => operationId)).size).toBe(1)
    expect(accepted.filter(({ outcome }) => outcome === 'accepted')).toHaveLength(1)
    await notification
    expect(notifiedOperationId).toBe(accepted[0].operationId)
    await listener.unlisten()
    await producer.close()

    const worker = createPostgresRefreshOperations(connectionString)
    const lease = requireLease(await worker.claim('worker-a', 1_000, testAdmission), 'proof')
    expect(await worker.commitProofEffect(lease)).toBe('applied')
    await expire(lease.operationId)
    expect(await worker.commitProofEffect(lease)).toBe('lease-lost')
    expect(await worker.claim('worker-b', 1_000, testAdmission)).toBeNull()

    const state = await worker.inspect(lease.operationId)
    expect(state.operation.status).toBe('succeeded')
    expect(state.effects).toHaveLength(1)
    expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['succeeded'])
    const afterTerminal = await worker.accept({ ...input, operationKey: `effect:${randomUUID()}` })
    expect(afterTerminal).toMatchObject({ outcome: 'accepted' })
    expect(afterTerminal.operationId).not.toBe(lease.operationId)
    expect(
      await runOneRefreshOperation(worker, 'worker-c', {
        leaseMs: 1_000,
        retryDelayMs: 1,
        admission: testAdmission,
      }),
    ).toBe(true)
    await worker.close()
  })

  test('rejects expired and superseded leases and detects conflicting effect keys', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const accepted = await operations.accept({
      dedupeKey: `fence:${randomUUID()}`,
      operationKey: `shared-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'A' },
      provenance: { source: 'integration-test' },
    })
    const stale = requireLease(await operations.claim('worker-a', 1_000, testAdmission), 'proof')
    await expire(stale.operationId)
    expect(await operations.commitProofEffect(stale)).toBe('lease-lost')
    const current = requireLease(await operations.claim('worker-b', 1_000, testAdmission), 'proof')
    expect(current.leaseToken).toBeGreaterThan(stale.leaseToken)
    expect(await operations.complete(stale)).toBe('lease-lost')
    expect(await operations.commitProofEffect(current)).toBe('applied')
    expect(await operations.complete(current)).toBe('transitioned')

    const conflicting = await operations.accept({
      dedupeKey: `conflict:${randomUUID()}`,
      operationKey: current.operationKey,
      workClass: 'interactive',
      payload: { value: 'B' },
      provenance: { source: 'integration-test' },
    })
    expect(
      await runOneRefreshOperation(operations, 'worker-c', {
        leaseMs: 1_000,
        retryDelayMs: 1,
        admission: testAdmission,
      }),
    ).toBe(true)
    const conflictState = await operations.inspect(conflicting.operationId)
    expect(conflictState.operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'effect_conflict', retryable: false },
    })
    expect(conflictState.effects).toHaveLength(0)
    expect((await operations.inspect(accepted.operationId)).effects).toHaveLength(1)
    await operations.close()
  })

  test('checkpoints completed interactive sections across lease expiry', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const reserved = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: `interactive:${randomUUID()}`,
      operationKey: `interactive:${randomUUID()}`,
      brawlhallaId: 42,
      staleSections: ['ranked', 'stats'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome !== 'reserved') throw new Error('Expected interactive reservation')
    expect(await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)).toBe(
      'transitioned',
    )
    const first = requireLease(
      await operations.claim('interactive-a', 1_000, testAdmission, 'interactive-player-refresh'),
    )
    if (first.kind !== 'interactive-player-refresh') throw new Error('Expected interactive lease')
    expect(await operations.beginInteractiveSection(first, 'ranked')).toBe('execute')
    expect(await operations.commitInteractiveSection(first, 'ranked')).toBe('transitioned')
    await expire(first.operationId)

    const retry = requireLease(
      await operations.claim('interactive-b', 1_000, testAdmission, 'interactive-player-refresh'),
    )
    if (retry.kind !== 'interactive-player-refresh') throw new Error('Expected interactive retry lease')
    expect(retry.leaseToken).toBeGreaterThan(first.leaseToken)
    expect(await operations.beginInteractiveSection(retry, 'ranked')).toBe('already-applied')
    expect(await operations.beginInteractiveSection(retry, 'stats')).toBe('execute')
    expect(await operations.commitInteractiveSection(first, 'stats')).toBe('lease-lost')
    expect(await operations.commitInteractiveSection(retry, 'stats')).toBe('transitioned')
    expect(await operations.complete(retry)).toBe('transitioned')
    await operations.close()
  })

  test('deduplicates concurrent clan refreshes and fences profile and roster checkpoints', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const dedupeKey = `clan:${randomUUID()}`
    const reservations = await Promise.all(
      Array.from({ length: 8 }, () =>
        operations.reserveInteractiveClanRefresh({
          dedupeKey,
          operationKey: dedupeKey,
          clanId: 77,
          staleSections: ['profile', 'roster'],
          provenance: { source: 'integration-test' },
          reservationTtlSeconds: 30,
        }),
      ),
    )
    expect(reservations.filter((result) => result.outcome === 'reserved')).toHaveLength(1)
    const reserved = reservations.find((result) => result.outcome === 'reserved')
    if (!reserved || reserved.outcome !== 'reserved') throw new Error('Expected clan reservation')
    await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
    const stale = requireLease(await operations.claim('clan-a', 1_000, testAdmission, 'clan-refresh'))
    if (stale.kind !== 'clan-refresh') throw new Error('Expected clan lease')
    expect(await operations.commitInteractiveSection(stale, 'profile')).toBe('transitioned')
    await expire(stale.operationId)
    const current = requireLease(await operations.claim('clan-b', 1_000, testAdmission, 'clan-refresh'))
    if (current.kind !== 'clan-refresh') throw new Error('Expected clan retry lease')
    expect(await operations.beginInteractiveSection(current, 'profile')).toBe('already-applied')
    expect(await operations.commitInteractiveSection(stale, 'roster')).toBe('lease-lost')
    expect(await operations.commitInteractiveSection(current, 'roster')).toBe('transitioned')
    expect(await operations.complete(current)).toBe('transitioned')
    await operations.close()
  })

  test('admits every implemented operation kind under shared cross-kind concurrency', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = {
      ...testAdmission,
      totalConcurrency: 8,
      interactiveReservation: 1,
      classConcurrency: { ...testAdmission.classConcurrency, interactive: 3, projection: 3 },
    } as const
    await settleWithin('configure cross-kind admission', operations.configureAdmission(admission))
    await settleWithin(
      'accept proof',
      operations.accept({
        dedupeKey: `cross-kind-proof:${randomUUID()}`,
        operationKey: `cross-kind-proof:${randomUUID()}`,
        workClass: 'interactive',
        payload: { value: 'proof' },
        provenance: { source: 'integration-test' },
      }),
    )
    await settleWithin(
      'accept ranked player pulse',
      operations.accept({
        kind: 'ranked-player-pulse',
        dedupeKey: `cross-kind-ranked-pulse:${randomUUID()}`,
        operationKey: `cross-kind-ranked-pulse:${randomUUID()}`,
        workClass: 'primary-monitoring',
        payload: { brawlhallaId: 41 },
        provenance: { source: 'integration-test' },
      }),
    )
    await settleWithin(
      'accept leaderboard',
      operations.accept({
        kind: 'leaderboard-1v1',
        dedupeKey: `cross-kind-leaderboard:${randomUUID()}`,
        operationKey: `cross-kind-leaderboard:${randomUUID()}`,
        workClass: 'leaderboard',
        payload: { pageDepth: 1, intervalMs: 60_000 },
        provenance: { source: 'integration-test' },
      }),
    )
    await settleWithin(
      'accept player discovery projection',
      operations.accept({
        kind: 'player-discovery-projection',
        dedupeKey: `cross-kind-player-discovery:${randomUUID()}`,
        operationKey: `cross-kind-player-discovery:${randomUUID()}`,
        workClass: 'projection',
        payload: { batchSize: 100 },
        provenance: { source: 'integration-test' },
      }),
    )
    await settleWithin(
      'accept clan discovery projection',
      operations.accept({
        kind: 'clan-discovery-projection',
        dedupeKey: `cross-kind-clan-discovery:${randomUUID()}`,
        operationKey: `cross-kind-clan-discovery:${randomUUID()}`,
        workClass: 'projection',
        payload: { batchSize: 100 },
        provenance: { source: 'integration-test' },
      }),
    )
    await settleWithin(
      'accept discovery reconciliation',
      operations.accept({
        kind: 'discovery-reconciliation',
        dedupeKey: `cross-kind-discovery-reconciliation:${randomUUID()}`,
        operationKey: `cross-kind-discovery-reconciliation:${randomUUID()}`,
        workClass: 'projection',
        payload: { owner: 'clan' },
        provenance: { source: 'integration-test' },
      }),
    )
    const player = await settleWithin(
      'reserve player',
      operations.reserveInteractivePlayerRefresh({
        dedupeKey: `cross-kind-player:${randomUUID()}`,
        operationKey: `cross-kind-player:${randomUUID()}`,
        brawlhallaId: 42,
        staleSections: ['ranked'],
        provenance: { source: 'integration-test' },
        reservationTtlSeconds: 30,
      }),
    )
    const clan = await settleWithin(
      'reserve clan',
      operations.reserveInteractiveClanRefresh({
        dedupeKey: `cross-kind-clan:${randomUUID()}`,
        operationKey: `cross-kind-clan:${randomUUID()}`,
        clanId: 77,
        staleSections: ['profile'],
        provenance: { source: 'integration-test' },
        reservationTtlSeconds: 30,
      }),
    )
    if (player.outcome !== 'reserved' || clan.outcome !== 'reserved') {
      throw new Error('Expected player and clan reservations')
    }
    await settleWithin(
      'activate player',
      operations.activateInteractiveRefresh(player.operationId, player.reservationToken),
    )
    await settleWithin('activate clan', operations.activateInteractiveRefresh(clan.operationId, clan.reservationToken))

    const leases = [
      requireLease(await settleWithin('proof claim', operations.claim('cross-kind-proof', 10_000, admission, 'proof'))),
      requireLease(
        await settleWithin(
          'player claim',
          operations.claim('cross-kind-player', 10_000, admission, 'interactive-player-refresh'),
        ),
      ),
      requireLease(
        await settleWithin(
          'ranked pulse claim',
          operations.claim('cross-kind-ranked-pulse', 10_000, admission, 'ranked-player-pulse'),
        ),
      ),
      requireLease(
        await settleWithin('clan claim', operations.claim('cross-kind-clan', 10_000, admission, 'clan-refresh')),
      ),
      requireLease(
        await settleWithin(
          'leaderboard claim',
          operations.claim('cross-kind-leaderboard', 10_000, admission, 'leaderboard-1v1'),
        ),
      ),
      requireLease(
        await settleWithin(
          'player discovery claim',
          operations.claim('cross-kind-player-discovery', 10_000, admission, 'player-discovery-projection'),
        ),
      ),
      requireLease(
        await settleWithin(
          'clan discovery claim',
          operations.claim('cross-kind-clan-discovery', 10_000, admission, 'clan-discovery-projection'),
        ),
      ),
      requireLease(
        await settleWithin(
          'discovery reconciliation claim',
          operations.claim('cross-kind-discovery-reconciliation', 10_000, admission, 'discovery-reconciliation'),
        ),
      ),
    ]
    expect(new Set(leases.map(({ kind }) => kind))).toEqual(
      new Set<OperationLease['kind']>([
        'proof',
        'interactive-player-refresh',
        'ranked-player-pulse',
        'leaderboard-1v1',
        'clan-refresh',
        'player-discovery-projection',
        'clan-discovery-projection',
        'discovery-reconciliation',
      ]),
    )
    expect(await operations.claim('cross-kind-blocked', 10_000, admission)).toBeNull()

    const control = postgres(connectionString, { max: 1 })
    try {
      await expect(
        settleWithin(
          'reject unknown operation kind',
          control`
            INSERT INTO refresh_operations.operations
              (id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
            VALUES
              (${randomUUID()}, 'unknown-refresh', ${randomUUID()}, ${randomUUID()}, 'interactive',
               ${control.json({ value: 'invalid' })}, ${control.json({ source: 'integration-test' })}, 1)
          `,
        ),
      ).rejects.toThrow()
    } finally {
      await settleWithin('close control connection', control.end())
    }

    for (const lease of leases) {
      await settleWithin(`complete ${lease.kind}`, operations.complete(lease))
    }
    await settleWithin('restore admission policy', operations.configureAdmission(testAdmission))
    await settleWithin('close cross-kind operations', operations.close())
  })

  test('runs the real route-to-polling-worker seam and dead-letters bounded runtime failures', async () => {
    const producer = createPostgresRefreshOperations(connectionString)
    const secret = 'operations-integration-secret-operations'
    const app = createRefreshOperationRoutes(producer, secret)
    const response = await app.request('/proof', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        dedupeKey: `route:${randomUUID()}`,
        operationKey: `route-effect:${randomUUID()}`,
        value: 'from-route',
      }),
    })
    const accepted = (await response.json()) as { operationId: string }
    expect(response.status).toBe(202)
    await producer.close()

    const worker = createPostgresRefreshOperations(connectionString)
    expect(
      await runOneRefreshOperation(worker, 'poll-worker', {
        leaseMs: 1_000,
        retryDelayMs: 1,
        admission: testAdmission,
      }),
    ).toBe(true)
    expect((await worker.inspect(accepted.operationId)).operation.status).toBe('succeeded')

    const poison = await worker.accept({
      dedupeKey: `poison:${randomUUID()}`,
      operationKey: `poison-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'poison' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      maxAttempts: 2,
    })
    const failEffect = async () => {
      throw new Error('Deliberate proof failure')
    }
    const options = {
      leaseMs: 1_000,
      retryDelayMs: 0,
      admission: testAdmission,
      executeEffect: failEffect,
    }
    expect(await runOneRefreshOperation(worker, 'worker-a', options)).toBe(true)
    expect(await runOneRefreshOperation(worker, 'worker-b', options)).toBe(true)

    const state = await worker.inspect(poison.operationId)
    expect(state.operation).toMatchObject({
      status: 'dead_letter',
      payload: { value: 'poison' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      attempt_count: 2,
      last_error: {
        code: 'proof_execution_failed',
        message: 'Deliberate proof failure',
        retryable: true,
      },
    })
    expect(state.attempts).toHaveLength(2)
    expect(state.attempts.every(({ outcome, error }) => outcome && error?.code === 'proof_execution_failed')).toBe(true)
    expect(state.effects).toHaveLength(0)
    await worker.close()
  })

  test('defers retry-aware source failures without consuming the durable attempt budget', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const deferred = await operations.accept({
      dedupeKey: `source-deferral:${randomUUID()}`,
      operationKey: `source-deferral:${randomUUID()}`,
      workClass: 'maintenance',
      payload: { value: 'source-deferral' },
      provenance: { source: 'integration-test', requestedBy: 'incident-220' },
      maxAttempts: 1,
    })
    const control = postgres(connectionString, { max: 1 })
    try {
      expect(
        await runOneRefreshOperation(operations, 'source-deferral-worker', {
          leaseMs: 1_000,
          retryDelayMs: 1,
          admission: testAdmission,
          executeEffect: async () => {
            throw new SourceAdmissionLimitedError(37)
          },
        }),
      ).toBe(true)

      const state = await operations.inspect(deferred.operationId)
      expect(state.operation).toMatchObject({
        status: 'pending',
        attempt_count: 0,
        last_error: {
          code: 'source_rate_limited',
          message: 'Source admission is rate limited',
          retryable: true,
        },
      })
      expect(state.attempts).toHaveLength(0)
    } finally {
      await control`
        DELETE FROM refresh_operations.operations
        WHERE id = ${deferred.operationId}
      `
      await control.end()
      await operations.close()
    }
  })

  test('supersedes obsolete pending leaderboard windows without leaving retry or alert backlog', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const control = postgres(connectionString, { max: 1 })
    const intervalMs = 60_000
    const schedule = await operations.reconcileLeaderboardSchedule({
      scheduleKey: `superseded-leaderboard:${randomUUID()}`,
      operationKeyPrefix: `superseded-leaderboard:${randomUUID()}`,
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      intervalMs,
      firstDueAt: new Date(Date.now() - 1_000).toISOString(),
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'integration-test', requestedBy: 'incident-220' },
    })
    try {
      const first = await operations.materializeDueSchedules()
      const firstOperationId = first.occurrences.find(
        ({ scheduleId }) => scheduleId === schedule.scheduleId,
      )?.operationId
      if (!firstOperationId) throw new Error('Expected the first leaderboard occurrence')
      const obsoleteLease = requireLease(
        await operations.claim('obsolete-leaderboard-worker', 10_000, testAdmission, 'leaderboard-1v1'),
      )
      expect(obsoleteLease.operationId).toBe(firstOperationId)

      await control`
        UPDATE refresh_operations.schedules
        SET next_due_at = clock_timestamp() - interval '1 second'
        WHERE id = ${schedule.scheduleId}
      `
      const second = await operations.materializeDueSchedules()
      expect(second.occurrences.filter(({ scheduleId }) => scheduleId === schedule.scheduleId)).toHaveLength(1)

      expect(await operations.inspectDeadLetter(firstOperationId)).toMatchObject({
        operation: {
          operationId: firstOperationId,
          lastError: { code: 'superseded_scheduled_operation', retryable: false },
          disposition: 'discarded',
        },
        attempts: [{ outcome: 'dead_letter', error: { code: 'superseded_scheduled_operation' } }],
      })
      expect(await operations.complete(obsoleteLease)).toBe('lease-lost')
      const history = await operations.inspectSchedule(schedule.scheduleId)
      expect(history.occurrences.map(({ operation_status }) => operation_status)).toEqual(['dead_letter', 'pending'])
      expect(
        (await operations.inspectTelemetry()).deadLetters.find(
          ({ workClass, kind }) => workClass === 'leaderboard' && kind === 'leaderboard-1v1',
        )?.count,
      ).toBe(0)
      const current = requireLease(
        await operations.claim('superseded-leaderboard-cleanup', 10_000, testAdmission, 'leaderboard-1v1'),
      )
      expect(await operations.complete(current)).toBe('transitioned')
    } finally {
      await control.end()
      await operations.close()
    }
  })

  test('coalesces missed windows once and retains anchored history after repository restart', async () => {
    const intervalMs = 3_600_000
    const firstDueAt = new Date(Date.now() - 5 * intervalMs - 10_000).toISOString()
    const schedulers = [
      createPostgresRefreshOperations(connectionString),
      createPostgresRefreshOperations(connectionString),
    ]
    await expect(
      schedulers[0].createSchedule({
        scheduleKey: `invalid-offset:${randomUUID()}`,
        operationKeyPrefix: 'invalid-offset',
        workClass: 'projection',
        intervalMs,
        firstDueAt: firstDueAt.replace('Z', '+00:00'),
        payload: { value: 'invalid' },
        provenance: { source: 'integration-test' },
      }),
    ).rejects.toThrow('UTC timestamp')
    await expect(
      schedulers[0].createSchedule({
        scheduleKey: `invalid-date:${randomUUID()}`,
        operationKeyPrefix: 'invalid-date',
        workClass: 'projection',
        intervalMs,
        firstDueAt: '2023-02-29T00:00:00Z',
        payload: { value: 'invalid' },
        provenance: { source: 'integration-test' },
      }),
    ).rejects.toThrow('valid timestamp')
    const scheduleDefinition = {
      scheduleKey: `catch-up:${randomUUID()}`,
      operationKeyPrefix: `catch-up-effect:${randomUUID()}`,
      workClass: 'projection' as const,
      intervalMs,
      firstDueAt,
      payload: { value: 'catch-up' },
      provenance: { source: 'integration-test', requestedBy: 'issue-192' },
    }
    const created = await schedulers[0].createSchedule(scheduleDefinition)
    expect(await schedulers[1].createSchedule(scheduleDefinition)).toEqual({
      outcome: 'already-exists',
      scheduleId: created.scheduleId,
    })

    const materialized = await Promise.all(
      Array.from({ length: 20 }, (_, index) => schedulers[index % schedulers.length].materializeDueSchedules(1)),
    )
    expect(materialized.reduce((total, result) => total + result.occurrencesCreated, 0)).toBe(1)
    const [committedOccurrence] = materialized.flatMap((result) => result.occurrences)
    expect(committedOccurrence).toMatchObject({
      scheduleId: created.scheduleId,
      kind: 'proof',
      workClass: 'projection',
      missedWindowCount: 5,
    })
    expect(committedOccurrence.operationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(committedOccurrence.occurrenceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(committedOccurrence.latenessMs).toBeGreaterThanOrEqual(0)
    await Promise.all(schedulers.map((scheduler) => scheduler.close()))

    const restarted = createPostgresRefreshOperations(connectionString)
    const history = await restarted.inspectSchedule(created.scheduleId)
    expect(history.occurrences).toHaveLength(1)
    expect(history.occurrences[0]).toMatchObject({
      first_window_number: '0',
      last_window_number: '5',
      missed_window_count: '5',
      catch_up: true,
      operation_status: 'pending',
    })
    expect(Number(history.occurrences[0].lateness_ms)).toBeGreaterThanOrEqual(5 * intervalMs + 10_000)
    expect(history.schedule.next_window_number).toBe('6')
    expect(history.schedule.next_due_at.getTime()).toBe(new Date(firstDueAt).getTime() + 6 * intervalMs)
    expect(history.schedule.next_due_at.getTime()).toBeGreaterThan(Date.now())

    const lease = requireLease(await restarted.claim('schedule-cleanup', 10_000, testAdmission))
    expect(lease.workClass).toBe('projection')
    expect(await restarted.complete(lease)).toBe('transitioned')
    await restarted.close()
  })

  test('reconciles verified Primary monitoring across replicas, ownership changes, and restart', async () => {
    const intervalMs = 24 * 60 * 60 * 1_000
    const verifiedAt = new Date(Date.now() - intervalMs - 10_000)
    const replicas = [
      createPostgresRefreshOperations(connectionString),
      createPostgresRefreshOperations(connectionString),
    ]
    const assignmentId = randomUUID()
    const observedAt = new Date()
    const target = { assignmentId, brawlhallaId: 4242, verifiedAt }

    const reconciliations = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        replicas[index % replicas.length].reconcilePrimaryMonitoring({ observedAt, targets: [target] }),
      ),
    )
    expect(reconciliations.reduce((total, result) => total + result.created, 0)).toBe(1)
    expect(reconciliations.reduce((total, result) => total + result.retired, 0)).toBe(0)

    const materialized = await Promise.all(
      Array.from({ length: 20 }, (_, index) => replicas[index % replicas.length].materializeDueSchedules(1)),
    )
    expect(materialized.reduce((total, result) => total + result.occurrencesCreated, 0)).toBe(1)
    const monitoring = requireLease(
      await replicas[0].claim('primary-monitoring-worker', 10_000, testAdmission, 'interactive-player-refresh'),
      'interactive-player-refresh',
    )
    expect(monitoring).toMatchObject({
      workClass: 'primary-monitoring',
      payload: { brawlhallaId: 4242, staleSections: ['ranked', 'stats'] },
      provenance: { source: 'primary-player-monitoring', requestedBy: 'issue-208' },
    })
    expect(monitoring.scheduleWindowAt).toBe(new Date(verifiedAt.getTime() + intervalMs).toISOString())

    const interactive = await replicas[1].reserveInteractivePlayerRefresh({
      dedupeKey: `interactive-freshness:${randomUUID()}`,
      operationKey: `interactive-freshness:${randomUUID()}`,
      brawlhallaId: 4242,
      staleSections: ['ranked', 'stats'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    expect(interactive).toEqual({ outcome: 'already-active', operationId: monitoring.operationId })
    expect(await replicas[0].complete(monitoring)).toBe('transitioned')

    const control = postgres(connectionString, { max: 1 })
    const [schedule] = await control`
      SELECT id, provenance, enabled
      FROM refresh_operations.schedules
      WHERE schedule_key = ${`primary-player:4242:${assignmentId}`}
    `
    await Promise.all(replicas.map((replica) => replica.close()))

    const restarted = createPostgresRefreshOperations(connectionString)
    const history = await restarted.inspectSchedule(schedule.id)
    expect(history.schedule).toMatchObject({
      enabled: true,
      provenance: { source: 'primary-player-monitoring', requestedBy: 'issue-208' },
    })
    expect(history.occurrences[0]).toMatchObject({
      operation_status: 'succeeded',
      missed_window_count: '0',
      catch_up: false,
    })
    expect(Number(history.occurrences[0].lateness_ms)).toBeGreaterThanOrEqual(10_000)

    expect(
      await restarted.reconcilePrimaryMonitoring({ observedAt: new Date(observedAt.getTime() + 1), targets: [] }),
    ).toEqual({ created: 0, retired: 1 })
    const [retired] = await control`
      SELECT enabled FROM refresh_operations.schedules WHERE id = ${schedule.id}
    `
    expect(retired.enabled).toBe(false)
    expect(await restarted.reconcilePrimaryMonitoring({ observedAt, targets: [target] })).toEqual({
      created: 0,
      retired: 0,
    })

    const reassignedAt = new Date(Date.now() - intervalMs - 5_000)
    const reassignedSnapshot = {
      observedAt: new Date(observedAt.getTime() + 2),
      targets: [{ assignmentId: randomUUID(), brawlhallaId: 4343, verifiedAt: reassignedAt }],
    }
    expect(await restarted.reconcilePrimaryMonitoring(reassignedSnapshot)).toEqual({ created: 1, retired: 0 })
    expect(await restarted.reconcilePrimaryMonitoring(reassignedSnapshot)).toEqual({ created: 0, retired: 0 })

    const interactiveFirst = await restarted.reserveInteractivePlayerRefresh({
      dedupeKey: `interactive-first:${randomUUID()}`,
      operationKey: `interactive-first:${randomUUID()}`,
      brawlhallaId: 4343,
      staleSections: ['ranked', 'stats'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (interactiveFirst.outcome !== 'reserved') throw new Error('Expected interactive reservation')
    expect(
      await restarted.activateInteractiveRefresh(interactiveFirst.operationId, interactiveFirst.reservationToken),
    ).toBe('transitioned')
    expect(await restarted.materializeDueSchedules()).toMatchObject({ occurrencesCreated: 0 })
    const [reassignedSchedule] = await control`
      SELECT id FROM refresh_operations.schedules
      WHERE resource_key = 'player:4343' AND enabled
    `
    expect((await restarted.inspectSchedule(reassignedSchedule.id)).occurrences).toHaveLength(0)

    const interactiveLease = requireLease(
      await restarted.claim('interactive-first-worker', 10_000, testAdmission, 'interactive-player-refresh'),
      'interactive-player-refresh',
    )
    expect(interactiveLease.operationId).toBe(interactiveFirst.operationId)
    expect(await restarted.commitInteractiveSection(interactiveLease, 'ranked')).toBe('transitioned')
    expect(await restarted.commitInteractiveSection(interactiveLease, 'stats')).toBe('transitioned')
    expect(await restarted.complete(interactiveLease)).toBe('transitioned')
    expect(await restarted.materializeDueSchedules()).toMatchObject({ occurrencesCreated: 1 })
    expect((await restarted.inspectSchedule(reassignedSchedule.id)).occurrences[0]).toMatchObject({
      disposition: 'deduplicated',
      operation_id: null,
      deduplicated_to_operation_id: interactiveFirst.operationId,
      operation_status: 'succeeded',
    })

    const partialTarget = { assignmentId: randomUUID(), brawlhallaId: 4444, verifiedAt: reassignedAt }
    expect(
      await restarted.reconcilePrimaryMonitoring({
        observedAt: new Date(observedAt.getTime() + 3),
        targets: [...reassignedSnapshot.targets, partialTarget],
      }),
    ).toEqual({ created: 1, retired: 0 })
    const partialInteractive = await restarted.reserveInteractivePlayerRefresh({
      dedupeKey: `partial-interactive:${randomUUID()}`,
      operationKey: `partial-interactive:${randomUUID()}`,
      brawlhallaId: partialTarget.brawlhallaId,
      staleSections: ['stats'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (partialInteractive.outcome !== 'reserved') throw new Error('Expected partial interactive reservation')
    expect(await restarted.materializeDueSchedules()).toMatchObject({ occurrencesCreated: 0 })
    expect(
      await restarted.activateInteractiveRefresh(partialInteractive.operationId, partialInteractive.reservationToken),
    ).toBe('transitioned')
    const partialLease = requireLease(
      await restarted.claim('partial-interactive-worker', 10_000, testAdmission, 'interactive-player-refresh'),
      'interactive-player-refresh',
    )
    expect(await restarted.commitInteractiveSection(partialLease, 'stats')).toBe('transitioned')
    expect(await restarted.complete(partialLease)).toBe('transitioned')
    expect(await restarted.materializeDueSchedules()).toMatchObject({ occurrencesCreated: 1 })
    const monitoringAfterPartial = requireLease(
      await restarted.claim('monitoring-after-partial', 10_000, testAdmission, 'interactive-player-refresh'),
      'interactive-player-refresh',
    )
    expect(monitoringAfterPartial).toMatchObject({
      workClass: 'primary-monitoring',
      payload: { brawlhallaId: partialTarget.brawlhallaId, staleSections: ['ranked', 'stats'] },
    })
    expect(await restarted.complete(monitoringAfterPartial)).toBe('transitioned')
    await Promise.all([control.end(), restarted.close()])
  })

  test('expires abandoned blockers and requires both full-refresh checkpoints after the due watermark', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const control = postgres(connectionString, { max: 1 })
    const intervalMs = 24 * 60 * 60 * 1_000
    const expiredTarget = {
      assignmentId: randomUUID(),
      brawlhallaId: 4545,
      verifiedAt: new Date(Date.now() - intervalMs - 1_000),
    }
    const splitTarget = { assignmentId: randomUUID(), brawlhallaId: 4646, verifiedAt: new Date() }
    await operations.reconcilePrimaryMonitoring({ observedAt: new Date(), targets: [expiredTarget, splitTarget] })

    const abandoned = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: `abandoned:${randomUUID()}`,
      operationKey: `abandoned:${randomUUID()}`,
      brawlhallaId: expiredTarget.brawlhallaId,
      staleSections: ['ranked'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (abandoned.outcome !== 'reserved') throw new Error('Expected abandoned reservation')
    await control`
      UPDATE refresh_operations.operations
      SET reservation_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${abandoned.operationId}
    `
    expect(await operations.materializeDueSchedules()).toMatchObject({ occurrencesCreated: 1 })
    expect((await operations.inspect(abandoned.operationId)).operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'admission_reservation_expired' },
    })
    const afterAbandoned = requireLease(
      await operations.claim('after-abandoned', 10_000, testAdmission, 'interactive-player-refresh'),
      'interactive-player-refresh',
    )
    expect(afterAbandoned).toMatchObject({
      workClass: 'primary-monitoring',
      payload: { brawlhallaId: expiredTarget.brawlhallaId },
    })
    expect(await operations.complete(afterAbandoned)).toBe('transitioned')

    const split = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: `split:${randomUUID()}`,
      operationKey: `split:${randomUUID()}`,
      brawlhallaId: splitTarget.brawlhallaId,
      staleSections: ['ranked', 'stats'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (split.outcome !== 'reserved') throw new Error('Expected split reservation')
    expect(await operations.activateInteractiveRefresh(split.operationId, split.reservationToken)).toBe('transitioned')
    const splitLease = requireLease(
      await operations.claim('split-worker', 10_000, testAdmission, 'interactive-player-refresh'),
      'interactive-player-refresh',
    )
    expect(await operations.commitInteractiveSection(splitLease, 'ranked')).toBe('transitioned')
    await control`
      UPDATE refresh_operations.schedules
      SET first_due_at = statement_timestamp(), next_due_at = statement_timestamp()
      WHERE resource_key = ${`player:${splitTarget.brawlhallaId}`} AND enabled
    `
    await Bun.sleep(5)
    expect(await operations.commitInteractiveSection(splitLease, 'stats')).toBe('transitioned')
    expect(await operations.complete(splitLease)).toBe('transitioned')

    expect(await operations.materializeDueSchedules()).toMatchObject({ occurrencesCreated: 1 })
    const afterSplit = requireLease(
      await operations.claim('after-split', 10_000, testAdmission, 'interactive-player-refresh'),
      'interactive-player-refresh',
    )
    expect(afterSplit).toMatchObject({
      workClass: 'primary-monitoring',
      payload: { brawlhallaId: splitTarget.brawlhallaId },
    })
    expect(await operations.complete(afterSplit)).toBe('transitioned')
    await Promise.all([control.end(), operations.close()])
  })

  test('keeps scheduled effects idempotent without colliding across schedules', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const sharedPrefix = `shared-schedule-effect:${randomUUID()}`
    const firstDueAt = new Date(Date.now() - 1_000).toISOString()
    for (let index = 0; index < 2; index += 1) {
      await operations.createSchedule({
        scheduleKey: `shared-prefix:${index}:${randomUUID()}`,
        operationKeyPrefix: sharedPrefix,
        workClass: 'projection',
        intervalMs: 3_600_000,
        firstDueAt,
        payload: { value: `${index}` },
        provenance: { source: 'integration-test', requestedBy: 'issue-192' },
      })
    }
    expect(await operations.materializeDueSchedules()).toMatchObject({ occurrencesCreated: 2 })
    const leases = [
      requireLease(await operations.claim('shared-prefix-1', 10_000, testAdmission), 'proof'),
      requireLease(await operations.claim('shared-prefix-2', 10_000, testAdmission), 'proof'),
    ]
    expect(new Set(leases.map(({ operationKey }) => operationKey)).size).toBe(2)
    for (const lease of leases) {
      expect(await operations.commitProofEffect(lease)).toBe('applied')
      expect(await operations.complete(lease)).toBe('transitioned')
    }
    await operations.close()
  })

  test('hard-reserves interactive capacity while background work is due', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = {
      ...testAdmission,
      totalConcurrency: 4,
      interactiveReservation: 1,
      classConcurrency: {
        ...testAdmission.classConcurrency,
        interactive: 2,
        maintenance: 4,
      },
    } as const
    await operations.configureAdmission(admission)
    for (let index = 0; index < 4; index += 1) {
      await operations.accept({
        dedupeKey: `reserved-capacity:${randomUUID()}`,
        operationKey: `reserved-capacity-effect:${randomUUID()}`,
        workClass: 'maintenance',
        payload: { value: `${index}` },
        provenance: { source: 'integration-test' },
      })
    }
    const claimers = Array.from({ length: 8 }, () => createPostgresRefreshOperations(connectionString))
    const concurrentClaims = await Promise.all(
      claimers.map((claimer, index) => claimer.claim(`background-${index}`, 10_000, admission)),
    )
    const backgroundLeases = concurrentClaims.filter((lease): lease is OperationLease => lease !== null)
    expect(backgroundLeases).toHaveLength(3)
    expect(backgroundLeases.every(({ workClass }) => workClass === 'maintenance')).toBe(true)
    await Promise.all(claimers.map((claimer) => claimer.close()))

    await operations.accept({
      dedupeKey: `interactive:${randomUUID()}`,
      operationKey: `interactive-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'interactive' },
      provenance: { source: 'integration-test' },
    })
    const interactive = requireLease(await operations.claim('interactive-priority', 10_000, admission))
    expect(interactive.workClass).toBe('interactive')

    for (const lease of [...backgroundLeases, interactive]) {
      expect(await operations.complete(lease)).toBe('transitioned')
    }
    const remainingBackground = requireLease(await operations.claim('remaining-background', 10_000, admission))
    expect(await operations.complete(remainingBackground)).toBe('transitioned')
    await operations.close()
  })

  test('keeps a two-slot worker available for Player refresh during Discovery work', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = {
      ...testAdmission,
      totalConcurrency: 2,
      interactiveReservation: 1,
      classConcurrency: {
        interactive: 2,
        'primary-monitoring': 2,
        leaderboard: 1,
        'global-statistics': 1,
        projection: 2,
        maintenance: 1,
      },
    } as const
    await operations.configureAdmission(admission)
    await operations.accept({
      kind: 'player-discovery-projection',
      dedupeKey: `player-projection:${randomUUID()}`,
      operationKey: `player-projection:${randomUUID()}`,
      workClass: 'projection',
      payload: { batchSize: 500 },
      provenance: { source: 'integration-test' },
    })
    await operations.accept({
      kind: 'clan-discovery-projection',
      dedupeKey: `clan-projection:${randomUUID()}`,
      operationKey: `clan-projection:${randomUUID()}`,
      workClass: 'projection',
      payload: { batchSize: 500 },
      provenance: { source: 'integration-test' },
    })

    const discovery = requireLease(await operations.claim('discovery', 10_000, admission))
    expect(discovery.kind).toBe('player-discovery-projection')
    expect(await operations.claim('reserved-slot', 10_000, admission)).toBeNull()

    const reserved = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: `player-refresh:${randomUUID()}`,
      operationKey: `player-refresh:${randomUUID()}`,
      brawlhallaId: 42,
      staleSections: ['ranked', 'stats'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome !== 'reserved') throw new Error('Expected interactive reservation')
    expect(await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)).toBe(
      'transitioned',
    )
    const interactive = requireLease(await operations.claim('player-refresh', 10_000, admission))
    expect(interactive.kind).toBe('interactive-player-refresh')

    expect(await operations.complete(interactive)).toBe('transitioned')
    expect(await operations.complete(discovery)).toBe('transitioned')
    const remainingDiscovery = requireLease(await operations.claim('remaining-discovery', 10_000, admission))
    expect(remainingDiscovery.kind).toBe('clan-discovery-projection')
    expect(await operations.complete(remainingDiscovery)).toBe('transitioned')
    await operations.close()
  })

  test('enforces class bounds and persists deterministic weighted admission across replicas', async () => {
    const admission = {
      ...testAdmission,
      totalConcurrency: 4,
      interactiveReservation: 1,
      classConcurrency: {
        interactive: 2,
        'primary-monitoring': 4,
        leaderboard: 4,
        'global-statistics': 1,
        projection: 1,
        maintenance: 1,
      },
      backgroundWeights: {
        ...testAdmission.backgroundWeights,
        'primary-monitoring': 3,
        leaderboard: 1,
      },
    } as const
    const producer = createPostgresRefreshOperations(connectionString)
    await producer.configureAdmission(admission)
    await expect(producer.claim('mismatched-replica', 10_000, testAdmission)).rejects.toThrow(
      'differs from the policy active in PostgreSQL',
    )

    for (let index = 0; index < 2; index += 1) {
      await producer.accept({
        dedupeKey: `bounded:${randomUUID()}`,
        operationKey: `bounded-effect:${randomUUID()}`,
        workClass: 'maintenance',
        payload: { value: `${index}` },
        provenance: { source: 'integration-test' },
      })
    }
    const boundedReplicas = Array.from({ length: 4 }, () => createPostgresRefreshOperations(connectionString))
    const boundedClaims = await Promise.all(
      boundedReplicas.map((replica, index) => replica.claim(`bounded-${index}`, 10_000, admission)),
    )
    const boundedLeases = boundedClaims.filter((lease): lease is OperationLease => lease !== null)
    expect(boundedLeases).toHaveLength(1)
    expect(boundedLeases[0].workClass).toBe('maintenance')
    await Promise.all(boundedReplicas.map((replica) => replica.close()))
    expect(await producer.complete(boundedLeases[0])).toBe('transitioned')
    const boundedNext = requireLease(await producer.claim('bounded-2', 10_000, admission))
    expect(boundedNext.workClass).toBe('maintenance')
    expect(await producer.complete(boundedNext)).toBe('transitioned')

    for (const workClass of ['primary-monitoring', 'leaderboard'] as const) {
      for (let index = 0; index < 16; index += 1) {
        await producer.accept({
          dedupeKey: `weighted:${workClass}:${randomUUID()}`,
          operationKey: `weighted-effect:${workClass}:${randomUUID()}`,
          workClass,
          payload: { value: `${workClass}-${index}` },
          provenance: { source: 'integration-test' },
        })
      }
    }
    await producer.close()

    const sequence: string[] = []
    for (let replicaNumber = 0; replicaNumber < 2; replicaNumber += 1) {
      const replica = createPostgresRefreshOperations(connectionString)
      for (let index = 0; index < 8; index += 1) {
        const lease = requireLease(await replica.claim(`replica-${replicaNumber}`, 10_000, admission))
        sequence.push(lease.workClass)
        expect(await replica.complete(lease)).toBe('transitioned')
      }
      await replica.close()
    }
    expect(sequence).toEqual(
      Array.from({ length: 4 }, () => [
        'primary-monitoring',
        'primary-monitoring',
        'leaderboard',
        'primary-monitoring',
      ]).flat(),
    )

    const cleanup = createPostgresRefreshOperations(connectionString)
    for (;;) {
      const lease = await cleanup.claim('weighted-cleanup', 10_000, admission)
      if (!lease) break
      expect(await cleanup.complete(lease)).toBe('transitioned')
    }
    await cleanup.close()
  })
})
