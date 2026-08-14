import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from 'bun'
import { type Context, Hono } from 'hono'
import { createHealthRoutes } from './health-routes'
import { readHealthPort, readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'

const patchedSwfSha256 = '7917260069245f004b851b1407a7914eae8500660609a31892bcd5d79bccf484'
const maxReplayBytes = 200 * 1024
const maxRequestBytes = 300 * 1024

export type RuntimeConfig = {
  runner: string
  homeDir: string
  steamRoot: string
  gameDir: string
  protonDir: string
  playbackMode: 'seek-end'
  timeoutMs: number
  termGraceMs: number
}

export class ReplayRuntimeError extends Error {
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

function readConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const playbackMode = env.PLAYBACK_MODE ?? 'seek-end'
  if (playbackMode !== 'seek-end') throw new Error('PLAYBACK_MODE must be seek-end')
  const homeDir = env.HOME ?? '/home/runner'
  const steamRoot = env.STEAM_ROOT ?? `${homeDir}/.steam/debian-installation`
  return {
    runner: env.REPLAY_SIMULATOR_RUNNER ?? '/app/apps/api/bin/run-steam-replay.sh',
    homeDir,
    steamRoot,
    gameDir: env.GAME_DIR ?? '/game',
    protonDir: env.PROTON_DIR ?? '/proton',
    playbackMode,
    timeoutMs: positiveInteger(
      env.REPLAY_SIMULATION_TIMEOUT_MS,
      5 * 60_000,
      'REPLAY_SIMULATION_TIMEOUT_MS',
      30 * 60_000,
    ),
    termGraceMs: positiveInteger(env.REPLAY_SIMULATOR_TERM_GRACE_MS, 10_000, 'REPLAY_SIMULATOR_TERM_GRACE_MS', 60_000),
  }
}

async function assertDirectory(path: string, name: string): Promise<void> {
  const info = await stat(path)
  if (!info.isDirectory()) throw new Error(`${name} must be a directory`)
}

async function assertExecutable(path: string, name: string): Promise<void> {
  const info = await stat(path)
  if (!info.isFile() || (info.mode & 0o111) === 0) throw new Error(`${name} must be executable`)
}

async function assertFile(path: string, name: string): Promise<void> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`${name} must be a file`)
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest('hex')
}

function numericDumpSlot(name: string): number {
  const match = /^BrawlhallaReplays([1-9][0-9]*)\.json$/.exec(name)
  if (!match) throw new ReplayRuntimeError(`unexpected dump file ${name}`, 'replay_dump_invalid', false)
  return Number(match[1])
}

async function readTerminalPayloads(outputDir: string, expectedDumps: number): Promise<unknown[]> {
  const names = (await readdir(outputDir))
    .filter((name) => /^BrawlhallaReplays[1-9][0-9]*\.json$/.test(name))
    .sort((left, right) => numericDumpSlot(left) - numericDumpSlot(right))
  if (names.length !== expectedDumps) {
    throw new ReplayRuntimeError(
      `expected ${expectedDumps} terminal dumps, found ${names.length}`,
      'replay_dump_cardinality',
      false,
    )
  }
  return Promise.all(
    names.map(async (name, index) => {
      const slot = numericDumpSlot(name)
      if (slot !== index + 1)
        throw new ReplayRuntimeError('terminal dump slots are not contiguous', 'replay_dump_slot', false)
      try {
        return JSON.parse(await readFile(join(outputDir, name), 'utf8'))
      } catch (error) {
        throw new ReplayRuntimeError(
          error instanceof Error ? error.message : 'malformed terminal dump JSON',
          'replay_dump_malformed_json',
          false,
        )
      }
    }),
  )
}

function combinedSignal(signals: readonly AbortSignal[]): AbortSignal {
  const active = signals.filter((signal) => !signal.aborted)
  if (active.length !== signals.length) return AbortSignal.abort()
  if (active.length === 1) return active[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active)
  const controller = new AbortController()
  const cleanups: Array<() => void> = []
  const abort = () => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    controller.abort()
  }
  for (const signal of active) {
    signal.addEventListener('abort', abort, { once: true })
    cleanups.push(() => signal.removeEventListener('abort', abort))
  }
  return controller.signal
}

async function terminateProcessTree(process: Bun.Subprocess, graceMs: number): Promise<void> {
  const exited = process.exited.then(
    () => true,
    () => true,
  )
  process.kill('SIGTERM')
  await Bun.spawn(['pkill', '-TERM', '-P', String(process.pid)], { stdout: 'ignore', stderr: 'ignore' }).exited.catch(
    () => undefined,
  )
  const stopped = await Promise.race([exited, Bun.sleep(graceMs).then(() => false)])
  if (stopped) return
  process.kill('SIGKILL')
  await Bun.spawn(['pkill', '-KILL', '-P', String(process.pid)], { stdout: 'ignore', stderr: 'ignore' }).exited.catch(
    () => undefined,
  )
  await Promise.race([exited, Bun.sleep(1_000)]).catch(() => undefined)
}

async function runNativeReplay(options: {
  config: RuntimeConfig
  replayPath: string
  outputDir: string
  expectedDumps: number
  signal: AbortSignal
}): Promise<void> {
  if (options.signal.aborted) {
    throw new ReplayRuntimeError('replay request was aborted before spawn', 'replay_cancelled', true)
  }
  const environment = {
    DISPLAY: ':99',
    EVIDENCE_DIR: join(options.outputDir, 'evidence'),
    EXPECTED_DUMPS: String(options.expectedDumps),
    EXPECTED_PATCHED_SWF_SHA256: patchedSwfSha256,
    GAME_DIR: options.config.gameDir,
    HOME: options.config.homeDir,
    PATH: '/usr/local/bin:/usr/bin:/bin',
    PLAYBACK_MODE: options.config.playbackMode,
    PROTON_DIR: options.config.protonDir,
    STEAM_ROOT: options.config.steamRoot,
  }
  const process = Bun.spawn([options.config.runner, options.replayPath, options.outputDir], {
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new Response(process.stdout).text().catch(() => '')
  const stderr = new Response(process.stderr).text().catch(() => '')
  let terminating: Promise<void> | undefined
  const abort = () => {
    terminating ??= terminateProcessTree(process, options.config.termGraceMs)
  }
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) abort()
  try {
    const exitCode = await process.exited
    if (terminating) await terminating
    if (options.signal.aborted) throw new ReplayRuntimeError('replay request was aborted', 'replay_cancelled', true)
    if (exitCode !== 0) {
      const details = [await stdout, await stderr].join('\n').trim().slice(-2_000)
      throw new ReplayRuntimeError(
        details || `replay runner exited with ${exitCode}`,
        exitCode === 2 ? 'replay_runner_permanent' : 'replay_runner_failed',
        exitCode !== 2,
      )
    }
  } finally {
    options.signal.removeEventListener('abort', abort)
    if (terminating) await terminating
  }
}

export function createReplaySimulatorRuntimeApp(options: {
  config: RuntimeConfig
  lifecycleSignal: AbortSignal
  readinessCheck?: () => Promise<void>
}) {
  let active = false
  const app = new Hono()

  async function simulate(context: Context) {
    const contentLength = Number(context.req.header('content-length') ?? 0)
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maxRequestBytes) {
      return context.json(
        { error: { code: 'replay_request_oversize', message: 'request body is too large', retryable: false } },
        413,
      )
    }
    let body: { replayBase64?: unknown; expectedDumps?: unknown; slug?: unknown }
    try {
      body = await context.req.json()
    } catch {
      return context.json(
        { error: { code: 'replay_request_malformed', message: 'request JSON is malformed', retryable: false } },
        400,
      )
    }
    if (typeof body.slug !== 'string' || !/^[A-Za-z0-9]{9}$/.test(body.slug)) {
      return context.json(
        { error: { code: 'replay_request_invalid', message: 'slug is invalid', retryable: false } },
        400,
      )
    }
    if (typeof body.replayBase64 !== 'string' || body.replayBase64.length === 0) {
      return context.json(
        { error: { code: 'replay_request_invalid', message: 'replayBase64 is required', retryable: false } },
        400,
      )
    }
    if (
      typeof body.expectedDumps !== 'number' ||
      !Number.isSafeInteger(body.expectedDumps) ||
      body.expectedDumps < 1 ||
      body.expectedDumps > 8
    ) {
      return context.json(
        { error: { code: 'replay_request_invalid', message: 'expectedDumps is invalid', retryable: false } },
        400,
      )
    }
    const expectedDumps = body.expectedDumps
    const replayBytes = Uint8Array.from(Buffer.from(body.replayBase64, 'base64'))
    if (replayBytes.length === 0 || replayBytes.length > maxReplayBytes) {
      return context.json(
        { error: { code: 'replay_request_oversize', message: 'replay payload size is invalid', retryable: false } },
        413,
      )
    }

    const workspace = await mkdtemp(join(tmpdir(), 'brawltome-replay-runtime-'))
    try {
      const replayPath = join(workspace, `${body.slug}.replay`)
      const outputDir = join(workspace, 'terminal')
      await mkdir(outputDir, { recursive: true })
      await Bun.write(replayPath, replayBytes)
      const signal = combinedSignal([
        context.req.raw.signal,
        options.lifecycleSignal,
        AbortSignal.timeout(options.config.timeoutMs),
      ])
      await runNativeReplay({
        config: options.config,
        replayPath,
        outputDir,
        expectedDumps,
        signal,
      })
      const terminalPayloads = await readTerminalPayloads(outputDir, expectedDumps)
      return context.json({ terminalPayloads }, 200)
    } catch (error) {
      const replayError =
        error instanceof ReplayRuntimeError
          ? error
          : new ReplayRuntimeError(
              error instanceof Error ? error.message : 'replay runtime failed',
              'replay_runtime_failed',
              true,
            )
      const status = replayError.retryable ? 503 : 422
      return context.json(
        { error: { code: replayError.code, message: replayError.message, retryable: replayError.retryable } },
        status,
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }

  app.post('/simulate', async (context) => {
    try {
      await options.readinessCheck?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'runtime is not ready'
      return context.json({ error: { code: 'replay_runtime_unready', message, retryable: true } }, 503)
    }
    if (active) {
      return context.json(
        { error: { code: 'replay_runtime_busy', message: 'runtime is already simulating', retryable: true } },
        409,
      )
    }
    active = true
    try {
      return await simulate(context)
    } finally {
      active = false
    }
  })
  return app
}

export function createReplayRuntimeReadiness(config: RuntimeConfig) {
  return [
    { name: 'replay-runner', check: () => assertExecutable(config.runner, 'replay runner') },
    {
      name: 'steam-binary',
      check: () => assertExecutable(join(config.steamRoot, 'ubuntu12_32/steam'), 'Steam binary'),
    },
    {
      name: 'game-executable',
      check: () => assertFile(join(config.gameDir, 'Brawlhalla.exe'), 'Brawlhalla executable'),
    },
    {
      name: 'patched-swf',
      check: async () => {
        const actual = await sha256File(join(config.gameDir, 'BrawlhallaAir.swf'))
        if (actual !== patchedSwfSha256) throw new Error('installed SWF does not match the pinned replay patch')
      },
    },
    { name: 'home-volume', check: () => assertDirectory(config.homeDir, 'home volume') },
    { name: 'game-volume', check: () => assertDirectory(config.gameDir, 'game volume') },
    { name: 'proton-volume', check: () => assertDirectory(config.protonDir, 'proton volume') },
  ]
}

if (import.meta.main) {
  const config = readConfig(process.env)
  const runtimeConfig = readRuntimeConfig(process.env)
  const lifecycle = createRuntimeLifecycle({
    ...runtimeConfig,
    readinessProbes: createReplayRuntimeReadiness(config),
  })
  const app = new Hono()
  app.route('/health', createHealthRoutes(lifecycle))
  app.route(
    '/',
    createReplaySimulatorRuntimeApp({
      config,
      lifecycleSignal: lifecycle.signal,
      readinessCheck: async () => {
        const readiness = await lifecycle.readiness()
        if (!readiness.ready) throw new Error(readiness.reason)
      },
    }),
  )
  const server = serve({ port: readHealthPort(process.env.HEALTH_PORT, 3004), fetch: app.fetch })
  lifecycle.markReady()
  const shutdown = () => {
    lifecycle.beginShutdown()
    void lifecycle.shutdown().finally(() => server.stop(true))
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, shutdown)
}
