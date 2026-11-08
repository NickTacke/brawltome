import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { proofEffectStore } from '@brawltome/accounts'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createPostgresRefreshOperations, refreshOperationsModule } from '@brawltome/refresh-operations'
import postgres from 'postgres'
import {
  allocatePort,
  deferLeaderboardSchedules,
  healthStatus,
  migrateDatabase,
  spawnRuntime,
  waitFor,
  waitForExit,
  waitForRuntimeReady,
} from './fixtures/runtime-processes'

let database: TestDatabase
let connectionString = ''

async function installEffectDelay(client: ReturnType<typeof postgres>, seconds: number): Promise<void> {
  await client.unsafe(`
    DROP FUNCTION IF EXISTS refresh_operations.test_delay_proof_effect() CASCADE;
    CREATE FUNCTION refresh_operations.test_delay_proof_effect() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_sleep(${seconds});
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_delay_proof_effect
      BEFORE INSERT ON accounts.proof_effects
      FOR EACH ROW EXECUTE FUNCTION refresh_operations.test_delay_proof_effect();
  `)
}

async function removeEffectDelay(client: ReturnType<typeof postgres>): Promise<void> {
  await client.unsafe('DROP FUNCTION IF EXISTS refresh_operations.test_delay_proof_effect() CASCADE')
}

function apiEnvironment(port: number) {
  return {
    DATABASE_URL: connectionString,
    INTERNAL_API_SECRET: 'runtime-process-test-secret-32-characters',
    METRICS_SCRAPE_SECRET: 'runtime-process-metrics-secret-32-chars',
    REFRESH_TRUST_COOKIE_SECRET: 'runtime-process-refresh-trust-secret-32-characters',
    REPLAY_BRIDGE_SECRET: 'runtime-process-replay-bridge-secret-32-characters',
    PORT: String(port),
    RUNTIME_SHUTDOWN_DEADLINE_MS: '2000',
    RUNTIME_CLEANUP_RESERVE_MS: '500',
  }
}

function workerEnvironment(port: number, deadlineMs: number): Record<string, string> {
  return {
    DATABASE_URL: connectionString,
    BRAWLHALLA_API_KEY: 'runtime-process-test-api-key',
    INTERNAL_API_SECRET: 'runtime-process-test-secret-32-characters',
    METRICS_SCRAPE_SECRET: 'runtime-process-metrics-secret-32-chars',
    HEALTH_PORT: String(port),
    OPERATIONS_LEASE_MS: '5000',
    OPERATIONS_POLL_MS: '25',
    RUNTIME_SHUTDOWN_DEADLINE_MS: String(deadlineMs),
    RUNTIME_CLEANUP_RESERVE_MS: String(Math.floor(deadlineMs / 4)),
  }
}

beforeAll(async () => {
  // no modules: the real migrate command fills the database, as it does in production
  database = await createTestDatabase({ label: 'runtime_process', modules: [] })
  connectionString = database.connectionString
  await migrateDatabase(connectionString)
  await deferLeaderboardSchedules(database)
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

describe('real production runtime lifecycle', () => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    test(`API ${signal} keeps liveness separate from known-prefix readiness and exits within bounds`, async () => {
      const control = postgres(connectionString, { max: 1 })
      const migration = refreshOperationsModule.migrations[0]

      await control`
          UPDATE brawltome_migrations.history SET checksum = ${'0'.repeat(64)}
          WHERE identity = ${migration.identity}
        `

      const port = await allocatePort()
      const runtime = spawnRuntime('apps/api/src/serve.ts', apiEnvironment(port))

      try {
        await waitFor(async () => (await healthStatus(port, 'live')) === 200, 'API liveness')
        expect(await healthStatus(port, 'ready')).toBe(503)

        await control`
            UPDATE brawltome_migrations.history SET checksum = ${migration.checksum}
            WHERE identity = ${migration.identity}
          `

        await waitFor(async () => (await healthStatus(port, 'ready')) === 200, 'API known-prefix readiness')

        const correlated = await fetch(`http://127.0.0.1:${port}/health/live`, {
          headers: { 'x-request-id': 'runtime-process-request' },
        })

        expect(correlated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
        expect(correlated.headers.get('x-request-id')).not.toBe('runtime-process-request')
        expect((await fetch(`http://127.0.0.1:${port}/metrics`)).status).toBe(401)

        expect(
          (
            await fetch(`http://127.0.0.1:${port}/metrics`, {
              headers: { 'x-metrics-secret': apiEnvironment(port).INTERNAL_API_SECRET },
            })
          ).status,
        ).toBe(401)

        const metrics = await fetch(`http://127.0.0.1:${port}/metrics`, {
          headers: { 'x-metrics-secret': apiEnvironment(port).METRICS_SCRAPE_SECRET },
        })

        expect(metrics.status).toBe(200)
        expect(await metrics.text()).toContain('http_server_requests_total')

        const startedAt = Date.now()

        runtime.process.kill(signal)
        await waitFor(async () => (await healthStatus(port, 'ready')) !== 200, 'API readiness shutdown', 500)
        const exited = await waitForExit(runtime, 3_000)

        expect(exited.exitCode).toBe(0)
        expect(Date.now() - startedAt).toBeLessThan(3_000)
      } finally {
        if (runtime.process.exitCode === null) runtime.process.kill('SIGKILL')

        await control`
            UPDATE brawltome_migrations.history SET checksum = ${migration.checksum}
            WHERE identity = ${migration.identity}
          `

        await control.end()
      }
    }, 20_000)
  }

  test('API announces shutdown to the load balancer and keeps serving before it drains', async () => {
    const port = await allocatePort()
    const environment = { ...apiEnvironment(port), RUNTIME_SHUTDOWN_ANNOUNCE_MS: '1000' }
    const runtime = spawnRuntime('apps/api/src/serve.ts', environment)

    const metrics = () =>
      fetch(`http://127.0.0.1:${port}/metrics`, { headers: { 'x-metrics-secret': environment.METRICS_SCRAPE_SECRET } })

    try {
      await waitFor(async () => (await healthStatus(port, 'serving')) === 200, 'API serving')

      const startedAt = Date.now()

      runtime.process.kill('SIGTERM')
      await waitFor(async () => (await healthStatus(port, 'serving')) === 503, 'API draining announcement', 500)
      expect((await metrics()).status).toBe(200)
      expect(Date.now() - startedAt).toBeLessThan(1_000)

      const exited = await waitForExit(runtime, 4_000)

      expect(exited.exitCode).toBe(0)
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000)
    } finally {
      if (runtime.process.exitCode === null) runtime.process.kill('SIGKILL')
    }
  }, 20_000)

  test('overlapping API and worker replicas preserve background separation and one durable effect', async () => {
    const operations = createPostgresRefreshOperations({ database }, { proofEffects: proofEffectStore })
    const control = postgres(connectionString, { max: 1 })

    const [apiPortOne, apiPortTwo, workerPortOne, workerPortTwo] = await Promise.all([
      allocatePort(),
      allocatePort(),
      allocatePort(),
      allocatePort(),
    ])

    const apis = [
      spawnRuntime('apps/api/src/serve.ts', apiEnvironment(apiPortOne)),
      spawnRuntime('apps/api/src/serve.ts', apiEnvironment(apiPortTwo)),
    ]

    const workers: Array<ReturnType<typeof spawnRuntime>> = []

    try {
      await Promise.all([
        waitForRuntimeReady(apis[0], apiPortOne, 'first API replica'),
        waitForRuntimeReady(apis[1], apiPortTwo, 'second API replica'),
      ])

      const dedupeKey = `rolling-overlap:${randomUUID()}`
      const operationKey = `rolling-overlap-effect:${randomUUID()}`

      const responses = await Promise.all(
        [apiPortOne, apiPortTwo].map((port) =>
          fetch(`http://127.0.0.1:${port}/internal/operations/proof`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-secret': apiEnvironment(port).INTERNAL_API_SECRET,
            },
            body: JSON.stringify({ dedupeKey, operationKey, value: 'completed-once', requestedBy: 'issue-220' }),
          }),
        ),
      )

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 202])
      const accepted = (await responses[0].json()) as { operationId: string }
      const duplicate = (await responses[1].json()) as { operationId: string }

      expect(duplicate.operationId).toBe(accepted.operationId)
      await Bun.sleep(200)
      expect((await operations.inspect(accepted.operationId)).operation.status).toBe('pending')

      await installEffectDelay(control, 2)

      workers.push(
        spawnRuntime('apps/api/src/operations-worker.ts', workerEnvironment(workerPortOne, 4_000)),
        spawnRuntime('apps/api/src/operations-worker.ts', workerEnvironment(workerPortTwo, 4_000)),
      )

      await Promise.all([
        waitForRuntimeReady(workers[0], workerPortOne, 'first worker replica'),
        waitForRuntimeReady(workers[1], workerPortTwo, 'second worker replica'),
      ])

      // 'leased' is only a transient state (the delayed effect holds it for ~2s). Under load the second replica can
      // take longer than that to become ready, so requiring a poll to observe it is a race; the single succeeded
      // attempt and single effect asserted below are the durable proof that exactly one replica leased the work.
      await waitFor(
        async () => (await operations.inspect(accepted.operationId)).operation.status === 'succeeded',
        'overlap proof effect',
        30_000,
      )

      const state = await operations.inspect(accepted.operationId)

      expect(state.effects).toHaveLength(1)
      expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['succeeded'])
    } finally {
      for (const runtime of [...apis, ...workers]) {
        if (runtime.process.exitCode === null) runtime.process.kill('SIGTERM')
      }

      await Promise.all(
        [...apis, ...workers].map(async (runtime) => {
          if (runtime.process.exitCode === null) await waitForExit(runtime, 5_000)
        }),
      )

      await removeEffectDelay(control)
      await control.end()
    }
  }, 90_000)

  test('operations worker SIGINT drains active durable work and commits one effect', async () => {
    const control = postgres(connectionString, { max: 1 })
    const operations = createPostgresRefreshOperations({ database }, { proofEffects: proofEffectStore })

    await installEffectDelay(control, 1.2)

    const accepted = await operations.accept({
      dedupeKey: `process-drain:${randomUUID()}`,
      operationKey: `process-drain-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'drained-once' },
      provenance: { source: 'runtime-process-test', requestedBy: 'SIGINT-process-test' },
    })

    const migration = refreshOperationsModule.migrations[0]

    await control`
        UPDATE brawltome_migrations.history SET checksum = ${'0'.repeat(64)}
        WHERE identity = ${migration.identity}
      `

    const port = await allocatePort()
    const runtime = spawnRuntime('apps/api/src/operations-worker.ts', workerEnvironment(port, 3_000))

    try {
      await waitFor(async () => (await healthStatus(port, 'live')) === 200, 'worker liveness')
      expect(await healthStatus(port, 'ready')).toBe(503)
      expect((await operations.inspect(accepted.operationId)).operation.status).toBe('pending')

      await control`
          UPDATE brawltome_migrations.history SET checksum = ${migration.checksum}
          WHERE identity = ${migration.identity}
        `

      await waitForRuntimeReady(runtime, port, 'worker readiness')

      await waitFor(async () => {
        const workerMetrics = await fetch(`http://127.0.0.1:${port}/metrics`, {
          headers: { 'x-metrics-secret': workerEnvironment(port, 3_000).METRICS_SCRAPE_SECRET },
        })

        return (
          workerMetrics.status === 200 && (await workerMetrics.text()).includes('worker_heartbeat_timestamp_seconds')
        )
      }, 'worker telemetry heartbeat')

      await waitFor(
        async () => (await operations.inspect(accepted.operationId)).operation?.status === 'leased',
        'active lease',
      )

      runtime.process.kill('SIGINT')
      const exited = await waitForExit(runtime, 4_000)

      expect(exited.exitCode, `stdout:\n${exited.stdout}\nstderr:\n${exited.stderr}`).toBe(0)
      const state = await operations.inspect(accepted.operationId)

      expect(state.operation.status).toBe('succeeded')
      expect(state.effects).toHaveLength(1)
      expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['succeeded'])
    } finally {
      if (runtime.process.exitCode === null) runtime.process.kill('SIGKILL')

      await control`
          UPDATE brawltome_migrations.history SET checksum = ${refreshOperationsModule.migrations[0].checksum}
          WHERE identity = ${refreshOperationsModule.migrations[0].identity}
        `

      await removeEffectDelay(control)
      await control.end()
    }
  }, 20_000)

  test('operations worker SIGTERM bounds shutdown and interrupted work recovers without duplicate effects', async () => {
    const control = postgres(connectionString, { max: 1 })
    const operations = createPostgresRefreshOperations({ database }, { proofEffects: proofEffectStore })

    await installEffectDelay(control, 3)

    const accepted = await operations.accept({
      dedupeKey: `process-recovery:${randomUUID()}`,
      operationKey: `process-recovery-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'recovered-once' },
      provenance: { source: 'runtime-process-test', requestedBy: 'SIGTERM-process-test' },
    })

    const firstPort = await allocatePort()
    const interrupted = spawnRuntime('apps/api/src/operations-worker.ts', workerEnvironment(firstPort, 1_000))
    let recovery: ReturnType<typeof spawnRuntime> | undefined

    try {
      await waitForRuntimeReady(interrupted, firstPort, 'interrupted worker readiness')

      await waitFor(
        async () => (await operations.inspect(accepted.operationId)).operation?.status === 'leased',
        'interrupted lease',
      )

      const startedAt = Date.now()

      interrupted.process.kill('SIGTERM')
      const interruptedExit = await waitForExit(interrupted, 2_000)

      expect(interruptedExit.exitCode).not.toBe(0)
      expect(Date.now() - startedAt).toBeLessThan(2_000)
      expect((await operations.inspect(accepted.operationId)).effects).toHaveLength(0)

      await removeEffectDelay(control)

      await control`
          UPDATE refresh_operations.operations
          SET lease_expires_at = clock_timestamp() - interval '1 second'
          WHERE id = ${accepted.operationId}
        `

      const recoveryPort = await allocatePort()

      recovery = spawnRuntime('apps/api/src/operations-worker.ts', workerEnvironment(recoveryPort, 2_000))
      await waitForRuntimeReady(recovery, recoveryPort, 'recovery worker readiness')

      await waitFor(
        async () => (await operations.inspect(accepted.operationId)).operation?.status === 'succeeded',
        'recovered operation',
      )

      recovery.process.kill('SIGTERM')
      const recoveryExit = await waitForExit(recovery, 3_000)

      expect(recoveryExit.exitCode, `stdout:\n${recoveryExit.stdout}\nstderr:\n${recoveryExit.stderr}`).toBe(0)

      const state = await operations.inspect(accepted.operationId)

      expect(state.operation.status).toBe('succeeded')
      expect(state.effects).toHaveLength(1)
      expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['lease_expired', 'succeeded'])
    } finally {
      if (interrupted.process.exitCode === null) interrupted.process.kill('SIGKILL')

      if (recovery?.process.exitCode === null) recovery.process.kill('SIGKILL')

      await removeEffectDelay(control)
      await control.end()
    }
  }, 25_000)
})
