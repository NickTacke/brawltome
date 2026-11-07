import type { Database } from '@brawltome/foundation'
import { createPostgresRefreshOperations } from '@brawltome/refresh-operations'
import {
  leaderboardDeepCrawlScheduleDefinitions,
  leaderboardScheduleDefinitions,
  readOperationsWorkerConfig,
} from '../../src/operations-worker-config'

const repositoryRoot = import.meta.dir.replace('/apps/api/tests/fixtures', '')

export type RuntimeProcess = ReturnType<typeof spawnRuntime>

export async function allocatePort(): Promise<number> {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response('reserved') })
  const port = reservation.port

  await reservation.stop(true)
  if (port === undefined) throw new Error('Bun did not allocate a test port')

  return port
}

export function spawnRuntime(entrypoint: string, env: Record<string, string>) {
  const process = Bun.spawn(['bun', 'run', entrypoint], {
    cwd: repositoryRoot,
    env: { ...Bun.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = new Response(process.stdout).text()
  const stderr = new Response(process.stderr).text()

  return { process, stdout, stderr }
}

export async function waitFor(
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

export async function healthStatus(port: number, endpoint: 'live' | 'ready' | 'serving'): Promise<number | null> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health/${endpoint}`)).status
  } catch {
    return null
  }
}

export async function waitForRuntimeReady(runtime: RuntimeProcess, port: number, message: string): Promise<void> {
  let lastHealth = 'unreachable'

  try {
    await waitFor(
      async () => {
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
      },
      message,
      30_000,
    )
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; last health: ${lastHealth}`)
  }
}

export async function waitForExit(
  runtime: RuntimeProcess,
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

  if (result.timedOut) {
    throw new Error(`Runtime did not exit within ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  }

  return { exitCode: result.exitCode, stdout, stderr }
}

// runs the real migrate command, which fills the database as it does in production
export async function migrateDatabase(connectionString: string): Promise<void> {
  const migration = Bun.spawn(['bun', 'run', 'db:migrate'], {
    cwd: repositoryRoot,
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

// the worker reconciles these at startup; deferring them keeps it from crawling the real V1 leaderboard
export async function deferLeaderboardSchedules(database: Database): Promise<void> {
  const operations = createPostgresRefreshOperations({ database })
  const config = readOperationsWorkerConfig({})

  for (const definition of leaderboardScheduleDefinitions(config.leaderboard)) {
    await operations.reconcileLeaderboardSchedule(definition)
  }

  for (const definition of leaderboardDeepCrawlScheduleDefinitions(config.deepCrawl)) {
    await operations.reconcileLeaderboardDeepCrawlSchedule(definition)
  }

  await database.sql`UPDATE refresh_operations.schedules SET next_due_at = '2100-01-01T00:00:00Z'`
}
