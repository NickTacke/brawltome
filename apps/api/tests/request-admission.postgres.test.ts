import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import {
  createPostgresRequestAdmission,
  requestAdmissionMigrationInventory,
} from '@brawltome/request-admission/composition'
import postgres from 'postgres'
import { reconcileInteractiveAdmissions, runOneRefreshOperation } from '../src/refresh-operations-worker'

const testAdmission = {
  totalConcurrency: 2,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
} as const

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_admission_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Request Admission integration tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of [...refreshOperationsMigrationInventory, ...requestAdmissionMigrationInventory]) {
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

beforeEach(async () => {
  const control = postgres(connectionString, { max: 1 })
  try {
    await control.unsafe(
      'TRUNCATE request_admission.actor_reservations, request_admission.source_reservations, request_admission.source_windows, request_admission.actor_windows, refresh_operations.interactive_refresh_effects, refresh_operations.proof_effects, refresh_operations.attempts, refresh_operations.operations CASCADE',
    )
  } finally {
    await control.end()
  }
})

describe('PostgreSQL interactive refresh admission', () => {
  test('50 concurrent duplicates reserve one operation and consume actor/source once', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180, 'brawlhalla-v1': 300 },
    })
    const dedupeKey = `player:42:${randomUUID()}`
    const attempts = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const reserved = await operations.reserveInteractivePlayerRefresh({
          dedupeKey,
          operationKey: dedupeKey,
          brawlhallaId: 42,
          staleSections: ['ranked', 'stats'],
          provenance: { source: 'integration-test' },
          reservationTtlSeconds: 30,
        })
        if (reserved.outcome === 'already-active') return reserved
        const actor = await admission.admitActor({ kind: 'verified-anonymous', ip: '203.0.113.42' })
        expect(actor.outcome).toBe('admitted')
        const source = await admission.admitSource({
          domain: 'brawlhalla-v0',
          reservationKey: reserved.operationId,
          units: 2,
        })
        expect(source.outcome).toBe('admitted')
        expect(await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)).toBe(
          'transitioned',
        )
        return reserved
      }),
    )

    expect(attempts.filter(({ outcome }) => outcome === 'reserved')).toHaveLength(1)
    expect(attempts.filter(({ outcome }) => outcome === 'already-active')).toHaveLength(49)
    expect(new Set(attempts.map(({ operationId }) => operationId)).size).toBe(1)
    expect(await admission.inspectUsage()).toMatchObject({
      actorUnits: 1,
      sourceUnits: { 'brawlhalla-v0': 2 },
      sourceReservations: 1,
    })
    await admission.close()
    await operations.close()
  })

  test('authenticated account and IP ceilings commit atomically', async () => {
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 1,
      sourceLimits: { 'brawlhalla-v0': 180 },
    })
    expect(await admission.admitActor({ kind: 'authenticated', accountId: 'account-a', ip: '203.0.113.7' })).toEqual({
      outcome: 'admitted',
    })
    expect(
      await admission.admitActor({ kind: 'authenticated', accountId: 'account-b', ip: '203.0.113.7' }),
    ).toMatchObject({ outcome: 'rate-limited', retryAfterSeconds: expect.any(Number) })
    expect((await admission.inspectUsage()).actorUnits).toBe(2)
    await admission.close()
  })

  test('reconciles actor-admitted work after a crash before activation', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180 },
    })
    const key = `activation-crash:${randomUUID()}`
    const reserved = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: key,
      operationKey: key,
      brawlhallaId: 42,
      staleSections: ['ranked'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 1,
    })
    if (reserved.outcome !== 'reserved') throw new Error('Expected interactive reservation')
    expect(
      await admission.admitActor({ kind: 'verified-anonymous', ip: '203.0.113.89' }, reserved.operationId),
    ).toEqual({ outcome: 'admitted' })

    expect(await reconcileInteractiveAdmissions(operations, admission)).toBe(1)
    expect((await operations.inspect(reserved.operationId)).operation.status).toBe('pending')
    expect((await admission.inspectUsage()).actorUnits).toBe(1)
    await admission.close()
    await operations.close()
  })

  test('deduplicates actor charging by stable operation reservation', async () => {
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180 },
    })
    const reservationKey = `operation:${randomUUID()}`
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        admission.admitActor({ kind: 'verified-anonymous', ip: '203.0.113.88' }, reservationKey),
      ),
    )
    expect(results.every(({ outcome }) => outcome === 'admitted')).toBe(true)
    expect((await admission.inspectUsage()).actorUnits).toBe(1)
    expect(await admission.hasActorReservation(reservationKey)).toBe(true)
    await admission.close()
  })

  test('uses one database timestamp when a transaction crosses a window boundary', async () => {
    let delayed = false
    let capturedAt: Date | undefined
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180 },
      windowSeconds: 1,
      afterWindowCaptured: async (databaseNow) => {
        capturedAt = databaseNow
        if (delayed) return
        delayed = true
        await Bun.sleep(1_100)
      },
    })
    expect(await admission.admitActor({ kind: 'verified-anonymous', ip: '203.0.113.99' }, randomUUID())).toEqual({
      outcome: 'admitted',
    })
    const control = postgres(connectionString, { max: 1 })
    try {
      const [window] = await control<{ window_started_at: Date }[]>`
        SELECT window_started_at FROM request_admission.actor_windows
        WHERE domain = 'anonymous-refresh'
      `
      if (!capturedAt) throw new Error('Expected captured database time')
      expect(window.window_started_at.getTime()).toBe(Math.floor(capturedAt.getTime() / 1_000) * 1_000)
      expect(Date.now() - capturedAt.getTime()).toBeGreaterThanOrEqual(1_000)
    } finally {
      await control.end()
      await admission.close()
    }
  })

  test('expires abandoned admission reservations before allowing replacement work', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const dedupeKey = `expired:${randomUUID()}`
    const first = await operations.reserveInteractivePlayerRefresh({
      dedupeKey,
      operationKey: dedupeKey,
      brawlhallaId: 77,
      staleSections: ['ranked'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    expect(first.outcome).toBe('reserved')
    const control = postgres(connectionString, { max: 1 })
    try {
      await control`
        UPDATE refresh_operations.operations SET reservation_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${first.operationId}
      `
    } finally {
      await control.end()
    }
    const replacement = await operations.reserveInteractivePlayerRefresh({
      dedupeKey,
      operationKey: dedupeKey,
      brawlhallaId: 77,
      staleSections: ['ranked'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    expect(replacement).toMatchObject({ outcome: 'reserved' })
    expect(replacement.operationId).not.toBe(first.operationId)
    expect((await operations.inspect(first.operationId)).operation.status).toBe('dead_letter')
    await operations.close()
  })

  test('admits every actual upstream call made inside one section', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180, 'brawlhalla-v1': 180 },
    })
    const key = `multi-call:${randomUUID()}`
    const reserved = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: key,
      operationKey: key,
      brawlhallaId: 42,
      staleSections: ['ranked'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome !== 'reserved') throw new Error('Expected interactive reservation')
    await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
    expect(
      await runOneRefreshOperation(operations, 'multi-call-worker', {
        leaseMs: 1_000,
        retryDelayMs: 0,
        admission: testAdmission,
        sourceAdmission: admission,
        executeSection: async (_lease, _section, admitSourceCall) => {
          await admitSourceCall('brawlhalla-v1')
          await admitSourceCall('brawlhalla-v1')
        },
      }),
    ).toBe(true)
    expect((await admission.inspectUsage()).sourceUnits).toEqual({ 'brawlhalla-v1': 2 })
    expect((await operations.inspect(reserved.operationId)).operation.status).toBe('succeeded')
    await admission.close()
    await operations.close()
  })

  test('dispatches proof, interactive, and leaderboard kinds through one fair claimant', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180 },
    })
    const proof = await operations.accept({
      dedupeKey: `dispatch-proof:${randomUUID()}`,
      operationKey: `dispatch-proof:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'proof' },
      provenance: { source: 'integration-test' },
    })
    const reserved = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: `dispatch-interactive:${randomUUID()}`,
      operationKey: `dispatch-interactive:${randomUUID()}`,
      brawlhallaId: 42,
      staleSections: ['ranked'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome !== 'reserved') throw new Error('Expected interactive reservation')
    await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
    const leaderboard = await operations.accept({
      kind: 'leaderboard-1v1',
      dedupeKey: `dispatch-leaderboard:${randomUUID()}`,
      operationKey: `dispatch-leaderboard:${randomUUID()}`,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 60_000 },
      provenance: { source: 'integration-test' },
    })
    const options = {
      leaseMs: 1_000,
      retryDelayMs: 0,
      admission: testAdmission,
      sourceAdmission: admission,
      executeSection: async () => undefined,
      leaderboardSource: {
        async fetchPage({ region }: { region: 'US-E' | 'EU' | 'SEA' | 'BRZ' | 'AUS' | 'US-W' | 'JPN' | 'ME' | 'SA' }) {
          return {
            rankings: [
              {
                id: 1,
                username: `${region} Player`,
                rating: 2_000,
                best_rating: 2_100,
                rank: 1,
                wins: 20,
                losses: 10,
                region,
                tier: 'Diamond',
              },
            ],
            totalPages: 1,
          }
        },
      },
      ranking: {
        async publish1v1Generation() {
          return 'published' as const
        },
        async record1v1CollectionFailure() {
          return 'recorded' as const
        },
      },
    }

    expect(await runOneRefreshOperation(operations, 'dispatch-worker', options)).toBe(true)
    expect(await runOneRefreshOperation(operations, 'dispatch-worker', options)).toBe(true)
    expect(await runOneRefreshOperation(operations, 'dispatch-worker', options)).toBe(true)
    expect((await operations.inspect(proof.operationId)).operation.status).toBe('succeeded')
    expect((await operations.inspect(reserved.operationId)).operation.status).toBe('succeeded')
    expect((await operations.inspect(leaderboard.operationId)).operation.status).toBe('succeeded')
    await admission.close()
    await operations.close()
  })

  test('continuously renews an interactive section beyond its initial lease', async () => {
    const operations = createPostgresRefreshOperations(connectionString, { executionConcurrency: 2 })
    const competing = createPostgresRefreshOperations(connectionString)
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180 },
    })
    const reserved = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: `renew-interactive:${randomUUID()}`,
      operationKey: `renew-interactive:${randomUUID()}`,
      brawlhallaId: 42,
      staleSections: ['ranked'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome !== 'reserved') throw new Error('Expected interactive reservation')
    await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
    let sectionStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      sectionStarted = resolve
    })
    const executing = runOneRefreshOperation(operations, 'renew-interactive-worker', {
      leaseMs: 200,
      renewEveryMs: 40,
      retryDelayMs: 0,
      admission: testAdmission,
      sourceAdmission: admission,
      executeSection: async () => {
        sectionStarted?.()
        await Bun.sleep(350)
      },
    })
    await started
    await Bun.sleep(240)
    expect(
      await competing.claim('competing-interactive-worker', 200, testAdmission, 'interactive-player-refresh'),
    ).toBeNull()
    expect(await executing).toBe(true)
    expect((await operations.inspect(reserved.operationId)).operation.status).toBe('succeeded')
    await competing.close()
    await admission.close()
    await operations.close()
  })

  test('charges every repeated upstream attempt after lease loss', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180 },
    })
    const key = `source-retry:${randomUUID()}`
    const reserved = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: key,
      operationKey: key,
      brawlhallaId: 42,
      staleSections: ['ranked'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome !== 'reserved') throw new Error('Expected interactive reservation')
    await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
    const first = await operations.claim('source-worker-a', 1_000, testAdmission, 'interactive-player-refresh')
    if (!first || first.kind !== 'interactive-player-refresh') throw new Error('Expected first interactive lease')
    expect(
      await admission.admitSource({
        domain: 'brawlhalla-v0',
        reservationKey: `${first.operationId}:ranked:${first.attemptNumber}`,
        units: 1,
      }),
    ).toMatchObject({ outcome: 'admitted', deduplicated: false })

    const control = postgres(connectionString, { max: 1 })
    try {
      await control`
        UPDATE refresh_operations.operations
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${first.operationId}
      `
    } finally {
      await control.end()
    }
    const retry = await operations.claim('source-worker-b', 1_000, testAdmission, 'interactive-player-refresh')
    if (!retry || retry.kind !== 'interactive-player-refresh') throw new Error('Expected retry interactive lease')
    expect(
      await admission.admitSource({
        domain: 'brawlhalla-v0',
        reservationKey: `${retry.operationId}:ranked:${retry.attemptNumber}`,
        units: 1,
      }),
    ).toMatchObject({ outcome: 'admitted', deduplicated: false })
    expect((await admission.inspectUsage()).sourceUnits).toEqual({ 'brawlhalla-v0': 2 })
    await admission.close()
    await operations.close()
  })

  test('never oversubscribes a source window and isolates domains', async () => {
    const admission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 5, 'brawlhalla-v1': 2 },
    })
    const v0 = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        admission.admitSource({ domain: 'brawlhalla-v0', reservationKey: `v0:${randomUUID()}:${index}`, units: 1 }),
      ),
    )
    expect(v0.filter(({ outcome }) => outcome === 'admitted')).toHaveLength(5)
    expect(v0.filter(({ outcome }) => outcome === 'rate-limited')).toHaveLength(15)
    expect(
      await admission.admitSource({ domain: 'brawlhalla-v1', reservationKey: randomUUID(), units: 2 }),
    ).toMatchObject({ outcome: 'admitted' })
    const duplicate = await admission.admitSource({
      domain: 'brawlhalla-v1',
      reservationKey: 'same-source-reservation',
      units: 2,
    })
    const duplicateAgain = await admission.admitSource({
      domain: 'brawlhalla-v1',
      reservationKey: 'same-source-reservation',
      units: 2,
    })
    expect(duplicate.outcome).toBe('rate-limited')
    expect(duplicateAgain.outcome).toBe('rate-limited')
    await admission.close()
  })
})
