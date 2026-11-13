import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { replaysModule } from '../index'
import { claimJob } from '../jobs'
import { cleanupReplayFiles, inspectReplayQueue, noteWorkerReport } from '../maintenance'
import type { ReplaysDeps } from '../model'
import { fakeReplay } from './fixtures/replays'

const connectionString = process.env.DATABASE_URL
const dayMs = 24 * 60 * 60 * 1000

describe.skipIf(!connectionString)('replay maintenance', () => {
  let database: TestDatabase
  let deps: ReplaysDeps & { objectStore: ReturnType<typeof createMemoryObjectStore> }

  beforeAll(async () => {
    database = await createTestDatabase({
      label: 'replays_maintenance',
      modules: [...accountsTestModules, replaysModule],
    })
  }, 20_000)

  afterAll(async () => {
    await database?.drop()
  }, 20_000)

  beforeEach(async () => {
    await database.sql`
      TRUNCATE replays.jobs, replays.match_uploads, replays.match_players, replays.matches, replays.uploads,
        replays.replay_files, replays.worker_reports, replays.builds
    `

    await database.sql`UPDATE replays.maintenance SET last_run_at = 'epoch'`
    deps = { database, objectStore: createMemoryObjectStore(), accounts: {} as Accounts }
  })

  // a stored file and, when parsed, its match built by `build`
  async function storedReplay(options: { patch: string | null; build?: string; createdDaysAgo?: number }) {
    const replay = fakeReplay()
    const createdAt = new Date(Date.now() - (options.createdDaysAgo ?? 0) * dayMs)

    await deps.objectStore.put(`replays/${replay.hex}.replay`, replay.bytes, 'application/octet-stream')

    await database.sql`
      INSERT INTO replays.replay_files (digest, byte_size, patch, created_at)
      VALUES (${replay.digest}, 64, ${options.patch}, ${createdAt})
    `

    if (options.build) {
      await database.sql`
        INSERT INTO replays.matches (digest, candidate_key, patch, format, build, map_id, map_name, mode_name,
          is_ranked, is_custom, has_teams, has_team_damage, duration_ms, is_reliable, failed_checks, unchecked, timeline_key)
        VALUES (${replay.digest}, 'key', ${options.patch ?? '11.00'}, 1, ${options.build}, 1, 'Map', 'Stock',
          true, false, false, false, 1000, true, '[]', '[]', ${`timelines/${randomUUID()}/${options.build}.json.gz`})
      `
    }

    return replay
  }

  async function reported(patch: string, firstDaysAgo: number, lastDaysAgo: number) {
    await database.sql`
      INSERT INTO replays.worker_reports (patch, first_reported_at, last_reported_at)
      VALUES (${patch}, ${new Date(Date.now() - firstDaysAgo * dayMs)}, ${new Date(Date.now() - lastDaysAgo * dayMs)})
    `
  }

  async function reparseJobs(): Promise<number> {
    const [row] = await database.sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM replays.jobs WHERE kind = 'reparse'`

    return row?.count ?? 0
  }

  test('a new build queues a re-parse for every match whose file is still kept', async () => {
    await storedReplay({ patch: '11.00', build: 'dev-1' })

    const expired = await storedReplay({ patch: '10.09', build: 'dev-1' })

    await database.sql`UPDATE replays.replay_files SET deleted_at = clock_timestamp() WHERE digest = ${expired.digest}`

    const report = await noteWorkerReport(database.sql, { build: 'dev-2', patches: ['11.00'] })

    expect(report.isNewBuild).toBe(true)
    expect(await reparseJobs()).toBe(1)
  })

  test('the same build reported twice queues nothing more', async () => {
    await storedReplay({ patch: '11.00', build: 'dev-1' })
    await noteWorkerReport(database.sql, { build: 'dev-1', patches: ['11.00'] })

    const again = await noteWorkerReport(database.sql, { build: 'dev-1', patches: ['11.00'] })

    expect(again.isNewBuild).toBe(false)
    expect(await reparseJobs()).toBe(0)
  })

  test('files of a patch the worker stopped reporting 8 days ago are deleted', async () => {
    await reported('10.08', 60, 30)
    await reported('10.09', 30, 8)
    await reported('11.00', 7, 0)
    await reported('11.01', 1, 0)

    const old = await storedReplay({ patch: '10.09', build: 'dev-1' })
    const current = await storedReplay({ patch: '11.00', build: 'dev-1' })

    expect(await cleanupReplayFiles(deps, new Date())).toBe(1)
    expect(deps.objectStore.keys()).toEqual([`replays/${current.hex}.replay`])

    const [row] = await database.sql<{ deleted: boolean }[]>`
      SELECT deleted_at IS NOT NULL AS deleted FROM replays.replay_files WHERE digest = ${old.digest}
    `

    expect(row?.deleted).toBe(true)
  })

  test('files of the two newest patches stay even when no patch was reported for 30 days', async () => {
    await reported('10.09', 90, 30)
    await reported('11.00', 60, 30)

    await storedReplay({ patch: '10.09', build: 'dev-1' })
    await storedReplay({ patch: '11.00', build: 'dev-1' })

    expect(await cleanupReplayFiles(deps, new Date())).toBe(0)
    expect(deps.objectStore.keys()).toHaveLength(2)
  })

  test('a match keeps its timeline when its replay file is deleted', async () => {
    await reported('10.09', 60, 20)
    await reported('11.00', 10, 0)
    await reported('11.01', 1, 0)

    const old = await storedReplay({ patch: '10.09', build: 'dev-1' })

    await cleanupReplayFiles(deps, new Date())

    const [match] = await database.sql<{ timelineKey: string | null }[]>`
      SELECT timeline_key AS "timelineKey" FROM replays.matches WHERE digest = ${old.digest}
    `

    expect(match?.timelineKey).toStartWith('timelines/')
  })

  test('a file that never became a match is deleted after 7 days', async () => {
    const unplayable = await storedReplay({ patch: null, createdDaysAgo: 8 })
    const recent = await storedReplay({ patch: null, createdDaysAgo: 1 })

    expect(await cleanupReplayFiles(deps, new Date())).toBe(1)
    expect(deps.objectStore.keys()).toEqual([`replays/${recent.hex}.replay`])
    expect(deps.objectStore.keys()).not.toContain(`replays/${unplayable.hex}.replay`)
  })

  test('claims note the report and run the cleanup at most once a day', async () => {
    await reported('10.09', 60, 20)
    await reported('11.00', 10, 0)
    await reported('11.01', 1, 0)
    await storedReplay({ patch: '10.09', build: 'dev-1' })

    await claimJob(deps, { build: 'dev-1', patches: ['11.00', '11.01'] })

    expect(deps.objectStore.keys()).toEqual([])

    // a file that expires later the same day waits for tomorrow's run
    await storedReplay({ patch: '10.09', build: 'dev-1' })
    await claimJob(deps, { build: 'dev-1', patches: ['11.00', '11.01'] })

    expect(deps.objectStore.keys()).toHaveLength(1)

    const [patch] = await database.sql<{ seen: boolean }[]>`
      SELECT last_reported_at > clock_timestamp() - interval '1 minute' AS seen FROM replays.worker_reports WHERE patch = '11.01'
    `

    expect(patch?.seen).toBe(true)
  })

  test('the queue inspection counts jobs by status and ages the oldest waiting one', async () => {
    const waiting = await storedReplay({ patch: null })
    const failed = await storedReplay({ patch: null })

    await database.sql`
      INSERT INTO replays.jobs (digest, kind, created_at) VALUES (${waiting.digest}, 'parse', clock_timestamp() - interval '2 minutes')
    `

    await database.sql`
      INSERT INTO replays.jobs (digest, kind, status, failure)
      VALUES (${failed.digest}, 'parse', 'failed', '{"code":"game-error","message":"x"}')
    `

    const inspection = await inspectReplayQueue(database.sql)

    expect(inspection.jobsByStatus).toEqual({ pending: 1, processing: 0, completed: 0, failed: 1 })
    expect(inspection.oldestPendingAgeMs).toBeGreaterThanOrEqual(120_000)
  })
})
