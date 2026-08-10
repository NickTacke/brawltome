import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_lifecycle_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

async function allocatePort(): Promise<number> {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response('reserved') })
  const port = reservation.port
  await reservation.stop(true)
  if (port === undefined) throw new Error('Bun did not allocate a test port')
  return port
}

function spawnRuntime(entrypoint: string, env: Record<string, string>) {
  const process = Bun.spawn(['bun', 'run', entrypoint], {
    cwd: import.meta.dir.replace('/apps/api/tests', ''),
    env: { ...Bun.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new Response(process.stdout).text()
  const stderr = new Response(process.stderr).text()
  return { process, stdout, stderr }
}

async function waitFor(
  check: () => Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(intervalMs)
  }
  throw new Error(`Timed out waiting for ${message}`)
}

async function healthStatus(port: number, endpoint: 'live' | 'ready'): Promise<number | null> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health/${endpoint}`)).status
  } catch {
    return null
  }
}

async function waitForRuntimeReady(
  runtime: ReturnType<typeof spawnRuntime>,
  port: number,
  message: string,
): Promise<void> {
  let lastHealth = 'unreachable'
  try {
    await waitFor(async () => {
      if (runtime.process.exitCode !== null) {
        const [stdout, stderr] = await Promise.all([runtime.stdout, runtime.stderr])
        throw new Error(`${message} exited during startup\nstdout:\n${stdout}\nstderr:\n${stderr}`)
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health/ready`)
        lastHealth = `${response.status} ${await response.text()}`
        return response.status === 200
      } catch {
        lastHealth = 'unreachable'
        return false
      }
    }, message)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; last health: ${lastHealth}`)
  }
}

async function waitForExit(
  runtime: ReturnType<typeof spawnRuntime>,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await Promise.race([
    runtime.process.exited.then((exitCode) => ({ timedOut: false as const, exitCode })),
    Bun.sleep(timeoutMs).then(() => ({ timedOut: true as const, exitCode: -1 })),
  ])
  if (result.timedOut) {
    runtime.process.kill('SIGKILL')
    await runtime.process.exited
  }
  const [stdout, stderr] = await Promise.all([runtime.stdout, runtime.stderr])
  if (result.timedOut)
    throw new Error(`Runtime did not exit within ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  return { exitCode: result.exitCode, stdout, stderr }
}

async function migrateDatabase(): Promise<void> {
  const migration = Bun.spawn(['bun', 'run', 'db:migrate'], {
    cwd: import.meta.dir.replace('/apps/api/tests', ''),
    env: { ...Bun.env, DATABASE_URL: connectionString },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    migration.exited,
    new Response(migration.stdout).text(),
    new Response(migration.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Migration failed\nstdout:\n${stdout}\nstderr:\n${stderr}`)
}

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
      BEFORE INSERT ON refresh_operations.proof_effects
      FOR EACH ROW EXECUTE FUNCTION refresh_operations.test_delay_proof_effect();
  `)
}

async function removeEffectDelay(client: ReturnType<typeof postgres>): Promise<void> {
  await client.unsafe('DROP FUNCTION IF EXISTS refresh_operations.test_delay_proof_effect() CASCADE')
}

function apiEnvironment(port: number): Record<string, string> {
  return {
    DATABASE_URL: connectionString,
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    INTERNAL_API_SECRET: 'runtime-process-test-secret-32-characters',
    REFRESH_TRUST_COOKIE_SECRET: 'runtime-process-refresh-trust-secret-32-characters',
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
    HEALTH_PORT: String(port),
    OPERATIONS_LEASE_MS: '5000',
    OPERATIONS_POLL_MS: '25',
    RUNTIME_SHUTDOWN_DEADLINE_MS: String(deadlineMs),
    RUNTIME_CLEANUP_RESERVE_MS: String(Math.floor(deadlineMs / 4)),
  }
}

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for runtime process tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  await migrateDatabase()
}, 30_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

describe('real V3 runtime lifecycle', () => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    test(`API ${signal} keeps liveness separate from exact-schema readiness and exits within bounds`, async () => {
      const control = postgres(connectionString, { max: 1 })
      const migration = refreshOperationsMigrationInventory[0]
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
        await waitFor(async () => (await healthStatus(port, 'ready')) === 200, 'API exact-schema readiness')
        const correlated = await fetch(`http://127.0.0.1:${port}/health/live`, {
          headers: { 'x-request-id': 'runtime-process-request' },
        })
        expect(correlated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
        expect(correlated.headers.get('x-request-id')).not.toBe('runtime-process-request')
        expect((await fetch(`http://127.0.0.1:${port}/metrics`)).status).toBe(401)
        const metrics = await fetch(`http://127.0.0.1:${port}/metrics`, {
          headers: { 'x-internal-secret': apiEnvironment(port).INTERNAL_API_SECRET },
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

  test('operations worker SIGINT drains active durable work and commits one effect', async () => {
    const control = postgres(connectionString, { max: 1 })
    const operations = createPostgresRefreshOperations(connectionString)
    await installEffectDelay(control, 1.2)
    const accepted = await operations.accept({
      dedupeKey: `process-drain:${randomUUID()}`,
      operationKey: `process-drain-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'drained-once' },
      provenance: { source: 'runtime-process-test', requestedBy: 'SIGINT-process-test' },
    })
    const migration = refreshOperationsMigrationInventory[0]
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
          headers: { 'x-internal-secret': workerEnvironment(port, 3_000).INTERNAL_API_SECRET },
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
      expect(exited.exitCode).toBe(0)
      const state = await operations.inspect(accepted.operationId)
      expect(state.operation.status).toBe('succeeded')
      expect(state.effects).toHaveLength(1)
      expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['succeeded'])
    } finally {
      if (runtime.process.exitCode === null) runtime.process.kill('SIGKILL')
      await control`
          UPDATE brawltome_migrations.history SET checksum = ${refreshOperationsMigrationInventory[0].checksum}
          WHERE identity = ${refreshOperationsMigrationInventory[0].identity}
        `
      await removeEffectDelay(control)
      await operations.close()
      await control.end()
    }
  }, 20_000)

  test('operations worker SIGTERM bounds shutdown and interrupted work recovers without duplicate effects', async () => {
    const control = postgres(connectionString, { max: 1 })
    const operations = createPostgresRefreshOperations(connectionString)
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
      expect((await waitForExit(recovery, 3_000)).exitCode).toBe(0)

      const state = await operations.inspect(accepted.operationId)
      expect(state.operation.status).toBe('succeeded')
      expect(state.effects).toHaveLength(1)
      expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['lease_expired', 'succeeded'])
    } finally {
      if (interrupted.process.exitCode === null) interrupted.process.kill('SIGKILL')
      if (recovery?.process.exitCode === null) recovery.process.kill('SIGKILL')
      await removeEffectDelay(control)
      await operations.close()
      await control.end()
    }
  }, 25_000)
})
