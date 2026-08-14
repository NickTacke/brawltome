import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { type ReplaySimulatorIdentity, analyzeReplay, createReplaySimulatorIdentity } from '@brawltome/matchmaking'
import type { OperationLease } from '@brawltome/refresh-operations'
import { createPostgresRefreshOperations } from '@brawltome/refresh-operations/composition'
import { parse } from '@brawltome/replay-format'
import { type R2Client, createR2Client } from '@brawltome/shared'
import { instrumentHttpHandler, renderPrometheus } from '@brawltome/telemetry'
import { serve } from 'bun'
import { Hono } from 'hono'
import { internalSecretValid } from './auth/internal-secret'
import { createHealthRoutes } from './health-routes'
import { readMatchmakingConfig } from './matchmaking-config'
import { readOperationsWorkerConfig } from './operations-worker-config'
import { createPostgresReadiness } from './postgres-readiness'
import { runOneRefreshOperation } from './refresh-operations-worker'
import { readHealthPort, readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'
import { runtimeMigrationInventory } from './runtime-migration-inventory'
import { createRuntimeTelemetry } from './telemetry'

type ReplayLease = Extract<OperationLease, { kind: 'replay-simulation' }>

class ReplaySimulationExecutionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`)
  }
  return parsed
}

function readRepositoryRevision(env: NodeJS.ProcessEnv): string {
  const revision = env.BRAWLTOME_REPOSITORY_REVISION ?? env.SOURCE_VERSION ?? env.GIT_REVISION
  if (!revision) throw new Error('BRAWLTOME_REPOSITORY_REVISION is required')
  return revision
}

async function withTimeoutSignal<T>(
  signal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (typeof AbortSignal.any === 'function') return operation(AbortSignal.any([signal, timeout]))
  if (signal.aborted) return operation(AbortSignal.abort())
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  timeout.addEventListener('abort', abort, { once: true })
  try {
    return await operation(controller.signal)
  } finally {
    signal.removeEventListener('abort', abort)
    timeout.removeEventListener('abort', abort)
  }
}

function responseErrorPayload(value: unknown): { code: string; message: string; retryable: boolean } | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null
  const error = (value as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'replay_runtime_failed'
  const message = 'message' in error && typeof error.message === 'string' ? error.message : 'Replay runtime failed'
  const retryable = !('retryable' in error) || error.retryable !== false
  return { code, message, retryable }
}

async function runtimeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ReplaySimulationExecutionError(
      'replay runtime returned malformed JSON',
      'replay_runtime_malformed_json',
      false,
    )
  }
}

async function requestRuntimeSimulation(options: {
  runtimeUrl: string
  replayBytes: Uint8Array
  slug: string
  expectedDumps: number
  timeoutMs: number
  signal: AbortSignal
}): Promise<unknown[]> {
  const response = await withTimeoutSignal(options.signal, options.timeoutMs, async (signal) =>
    fetch(new URL('/simulate', options.runtimeUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: options.slug,
        replayBase64: Buffer.from(options.replayBytes).toString('base64'),
        expectedDumps: options.expectedDumps,
      }),
      signal,
    }),
  ).catch((error) => {
    if (options.signal.aborted) {
      throw new ReplaySimulationExecutionError('replay lease lost or shutdown requested', 'replay_cancelled', true)
    }
    throw new ReplaySimulationExecutionError(
      error instanceof Error ? error.message : 'replay runtime unavailable',
      'replay_runtime_unavailable',
      true,
    )
  })
  const payload = await runtimeJson(response)
  if (!response.ok) {
    const runtimeError = responseErrorPayload(payload)
    throw new ReplaySimulationExecutionError(
      runtimeError?.message ?? `replay runtime failed with HTTP ${response.status}`,
      runtimeError?.code ?? 'replay_runtime_failed',
      runtimeError?.retryable ?? response.status >= 500,
    )
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as { terminalPayloads?: unknown }).terminalPayloads)
  ) {
    throw new ReplaySimulationExecutionError(
      'replay runtime response is missing terminal payloads',
      'replay_runtime_invalid',
      true,
    )
  }
  return (payload as { terminalPayloads: unknown[] }).terminalPayloads
}

function immutableStatsKey(slug: string, bytes: Uint8Array): string {
  const digest = createHash('sha256').update(bytes).digest('hex')
  return `stats/${slug}/${digest}.json`
}

async function executeReplaySimulation(options: {
  lease: ReplayLease
  r2: R2Client
  runtimeUrl: string
  timeoutMs: number
  identity: ReplaySimulatorIdentity
  signal: AbortSignal
}): Promise<{ detailedStatsKey: string }> {
  const replayBytes = await options.r2.get(options.lease.payload.replayStorageKey)
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(replayBytes)
  } catch (error) {
    throw new ReplaySimulationExecutionError(
      error instanceof Error ? error.message : 'replay parsing failed',
      'replay_parse_invalid',
      false,
    )
  }
  if (parsed.formatVersion !== 268) {
    throw new ReplaySimulationExecutionError(
      `unsupported replay format ${parsed.formatVersion}`,
      'replay_format_unsupported',
      false,
    )
  }
  const expectedDumps = parsed.entities.filter((entity) => !entity.isBot).length
  if (expectedDumps < 1) {
    throw new ReplaySimulationExecutionError('replay has no non-bot players', 'replay_no_players', false)
  }
  const terminalPayloads = await requestRuntimeSimulation({
    runtimeUrl: options.runtimeUrl,
    replayBytes,
    slug: options.lease.payload.slug,
    expectedDumps,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  })
  if (options.signal.aborted) {
    throw new ReplaySimulationExecutionError('replay lease lost or shutdown requested', 'replay_cancelled', true)
  }
  let analysis: unknown
  try {
    analysis = analyzeReplay(replayBytes, terminalPayloads, options.identity)
  } catch (error) {
    throw new ReplaySimulationExecutionError(
      error instanceof Error ? error.message : 'deterministic replay analysis failed',
      'replay_analysis_deterministic',
      false,
    )
  }
  const statsBytes = new TextEncoder().encode(`${JSON.stringify(analysis, null, 2)}\n`)
  const detailedStatsKey = immutableStatsKey(options.lease.payload.slug, statsBytes)
  await options.r2.put(detailedStatsKey, statsBytes, { contentType: 'application/json' })
  return { detailedStatsKey }
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const matchmakingConfig = readMatchmakingConfig()
const r2 = createR2Client(matchmakingConfig.r2)
if (!r2) throw new Error('R2 replay storage configuration is required')
const workerConfig = readOperationsWorkerConfig(process.env)
const runtimeConfig = readRuntimeConfig(process.env)
const telemetry = createRuntimeTelemetry('replay-simulator-worker')
const operations = createPostgresRefreshOperations(connectionString, { executionConcurrency: 1 })
const postgresReadiness = createPostgresReadiness(connectionString, runtimeMigrationInventory)
const runtimeUrl = process.env.REPLAY_SIMULATOR_RUNTIME_URL ?? 'http://replay-simulator-runtime:3004'
const timeoutMs = positiveInteger(
  process.env.REPLAY_SIMULATION_TIMEOUT_MS,
  5 * 60_000,
  'REPLAY_SIMULATION_TIMEOUT_MS',
  30 * 60_000,
)
const runtimeReadinessTimeoutMs = positiveInteger(
  process.env.REPLAY_SIMULATOR_RUNTIME_READINESS_TIMEOUT_MS,
  1_000,
  'REPLAY_SIMULATOR_RUNTIME_READINESS_TIMEOUT_MS',
  10_000,
)
const simulatorIdentity = createReplaySimulatorIdentity(readRepositoryRevision(process.env))
const workerId = `${hostname()}:${process.pid}:replay-simulator`
const healthServer = { current: undefined as ReturnType<typeof serve> | undefined }
let listener: Awaited<ReturnType<typeof operations.listen>> | undefined
let shutdownRequested = false

const lifecycle = createRuntimeLifecycle({
  ...runtimeConfig,
  readinessProbes: [
    { name: 'postgres-schema', check: postgresReadiness.check },
    {
      name: 'replay-simulator-runtime',
      check: async () => {
        const response = await fetch(new URL('/health/ready', runtimeUrl), {
          signal: AbortSignal.timeout(runtimeReadinessTimeoutMs),
        })
        if (!response.ok) throw new Error(`runtime readiness returned HTTP ${response.status}`)
      },
    },
  ],
  closers: [
    { name: 'health-server', close: async () => healthServer.current?.stop(true) },
    { name: 'postgres-listener', close: async () => listener?.unlisten() },
    { name: 'operations-postgres', close: operations.close },
    { name: 'readiness-postgres', close: postgresReadiness.close },
    { name: 'telemetry', close: () => telemetry.shutdown(runtimeConfig.cleanupReserveMs) },
  ],
})

const health = new Hono()
health.route('/health', createHealthRoutes(lifecycle))
health.get('/metrics', (context) => {
  if (!internalSecretValid(context.req.header('x-metrics-secret'), process.env.METRICS_SCRAPE_SECRET)) {
    return context.json({ error: 'unauthorized' }, 401)
  }
  return context.body(renderPrometheus(telemetry.metrics.snapshot()), 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'cache-control': 'no-store',
  })
})
healthServer.current = serve({
  port: readHealthPort(process.env.HEALTH_PORT, 3003),
  fetch: instrumentHttpHandler(telemetry, 'replay-simulator-worker', health.fetch),
})
lifecycle.markReady()

function requestShutdown(): void {
  if (shutdownRequested) return
  shutdownRequested = true
  lifecycle.beginShutdown()
  void lifecycle.shutdown().then(({ drained, cleanupCompleted, errors }) => {
    if (!drained || !cleanupCompleted) process.exit(1)
    if (errors.length > 0) process.exitCode = 1
  })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, requestShutdown)

function createWakeupWaiter(intervalMs: number, signal: AbortSignal) {
  let wake: (() => void) | undefined
  return {
    wake: () => wake?.(),
    wait: () =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        const done = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', done)
          wake = undefined
          resolve()
        }
        const timer = setTimeout(done, intervalMs)
        wake = done
        signal.addEventListener('abort', done, { once: true })
      }),
  }
}

const wakeup = createWakeupWaiter(workerConfig.pollMs, lifecycle.signal)
let admissionReady = false
let listenerReady = false

while (!lifecycle.signal.aborted) {
  const readiness = await lifecycle.readiness()
  if (!readiness.ready) {
    await wakeup.wait()
    continue
  }
  if (!admissionReady) {
    await operations.configureAdmission(workerConfig.admission)
    admissionReady = true
  }
  if (!listenerReady) {
    listener = await operations.listen(wakeup.wake)
    listenerReady = true
  }
  const finishWork = lifecycle.startWork()
  if (!finishWork) break
  try {
    const processed = await runOneRefreshOperation(operations, workerId, {
      leaseMs: workerConfig.leaseMs,
      retryDelayMs: workerConfig.retryDelayMs,
      admission: workerConfig.admission,
      claimKind: 'replay-simulation',
      executionSignal: lifecycle.signal,
      telemetry,
      executeReplaySimulation: (lease, signal) =>
        executeReplaySimulation({ lease, r2, runtimeUrl, timeoutMs, identity: simulatorIdentity, signal }),
    })
    telemetry.metrics.set('worker_heartbeat_timestamp_seconds', Date.now() / 1_000, {
      runtime: 'replay-simulator-worker',
    })
    if (!processed) await wakeup.wait()
  } catch (error) {
    telemetry.logger.error('replay.worker.loop.failed', error)
    await wakeup.wait()
  } finally {
    finishWork()
  }
}
