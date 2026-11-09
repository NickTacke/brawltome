import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  type CreateClanWeeklySnapshotSchedule,
  createPostgresRefreshOperations,
  type PostgresRefreshOperations,
  queueModule,
} from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { createTelemetry } from '@brawltome/telemetry'
import { createPostgresWeeklySnapshots } from '../../db/postgres-weekly-snapshots'
import { clanModule, createPostgresClans } from '../../index'
import { createClanWeeklySnapshotJob } from '../../jobs/clan-weekly-snapshot-job'
import { reconcileClanWeeklySnapshotSchedule } from '../../jobs/clan-weekly-snapshot-schedule'

const weekMs = 7 * 24 * 60 * 60 * 1000
const admitting = { admitSource: async () => ({ outcome: 'admitted' }) as const, pauseSource: async () => {} }

type SourceAnswer = { guildPoints: string } | 'not-found' | 'invalid' | 'fail-once'

type Harness = {
  job: ReturnType<typeof createClanWeeklySnapshotJob>
  queue: PostgresRefreshOperations
  sourceCalls: number[]
  waits: number[]
}

let database: TestDatabase

function guildStats(clanId: number, guildPoints: string) {
  return {
    guild_id: clanId,
    name: `Fresh ${clanId}`,
    create_date: 1660000000,
    xp: '10',
    legacy_xp: '5',
    notice: '',
    tags: [],
    discord_invite_code: '',
    guild_points: guildPoints,
    is_recruiting: false,
  }
}

async function storeGuild(clanId: number): Promise<void> {
  await database.sql`INSERT INTO clans.clans (clan_id) VALUES (${clanId})`

  await database.sql`
    INSERT INTO clans.profiles (clan_id, clan_name, clan_create_date, clan_xp, clan_lifetime_xp, guild_points)
    VALUES (${clanId}, ${`Stored ${clanId}`}, '2024-01-01T00:00:00.000Z', '1', '1', '1')
  `
}

function createHarness(answers: Map<number, SourceAnswer>, sliceGuilds = 100): Harness {
  const sourceCalls: number[] = []
  const waits: number[] = []
  const failedOnce = new Set<number>()

  const getGuildStatsV1 = async (clanId: number) => {
    sourceCalls.push(clanId)
    const answer = answers.get(clanId)

    if (answer === undefined || answer === 'not-found') return null

    if (answer === 'invalid') return { guild_id: clanId }

    if (answer === 'fail-once' && !failedOnce.has(clanId)) {
      failedOnce.add(clanId)
      throw new Error(`Brawlhalla API timeout for guild ${clanId}`)
    }

    return guildStats(clanId, answer === 'fail-once' ? '77' : answer.guildPoints)
  }

  const job = createClanWeeklySnapshotJob({
    clans: createPostgresClans(database),
    snapshots: createPostgresWeeklySnapshots(database),
    createAdmittedSource: () => ({ getGuildStatsV1 }),
    sliceGuilds,
    guildDelayMs: 500,
    waitBetweenGuilds: async (delayMs) => {
      waits.push(delayMs)
    },
    telemetry: createTelemetry({ service: 'operations-worker', drainIntervalMs: 0 }),
  })

  const queue = createPostgresRefreshOperations({ database }, { jobs: [job] })

  return { job, queue, sourceCalls, waits }
}

// a window that came due a minute ago is the only one the schedule owes, so the run's week is the day it is due
async function scheduleWeek(queue: PostgresRefreshOperations, name: string, firstDueAt?: string): Promise<string> {
  const dueAt = firstDueAt ?? new Date(Date.now() - 60_000).toISOString()

  const schedule: CreateClanWeeklySnapshotSchedule = {
    kind: 'clan-weekly-snapshot',
    scheduleKey: `test:weekly-snapshot:${name}`,
    operationKeyPrefix: `test:weekly-snapshot:${name}`,
    workClass: 'maintenance',
    intervalMs: weekMs,
    firstDueAt: dueAt,
    payload: {},
    provenance: { source: 'integration-test' },
    maxAttempts: 20,
  }

  await reconcileClanWeeklySnapshotSchedule(database, schedule)
  await queue.materializeDueSchedules()

  return dueAt.slice(0, 10)
}

async function readSnapshots(weekStarting: string) {
  const rows = await database.sql<{ clanId: number; guildPoints: string }[]>`
    SELECT clan_id AS "clanId", guild_points::text AS "guildPoints"
    FROM clans.weekly_snapshots
    WHERE week_starting = ${weekStarting}
    ORDER BY clan_id
  `

  return [...rows]
}

async function isWeekCompleted(weekStarting: string): Promise<boolean> {
  const [run] = await database.sql<{ isCompleted: boolean }[]>`
    SELECT completed_at IS NOT NULL AS "isCompleted" FROM clans.weekly_snapshot_runs WHERE week_starting = ${weekStarting}
  `

  return run?.isCompleted ?? false
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'clan_weekly_snapshot', modules: [queueModule, clanModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

beforeEach(async () => {
  await database.sql`TRUNCATE clans.clans, clans.weekly_snapshot_runs CASCADE`
  await database.sql`UPDATE queue.schedules SET enabled = false`
}, 20_000)

describe('clan weekly snapshot job', () => {
  test('finishes the week with no snapshots when no guild is stored', async () => {
    const { job, queue, sourceCalls } = createHarness(new Map())

    const week = await scheduleWeek(queue, 'empty')

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).toBe('succeeded')
    expect(sourceCalls).toEqual([])
    expect(await readSnapshots(week)).toEqual([])
    expect(await isWeekCompleted(week)).toBe(true)
  })

  test('saves the points of each guild under the day its window came due and refreshes the profile', async () => {
    await storeGuild(101)
    await storeGuild(102)

    const answers = new Map<number, SourceAnswer>([
      [101, { guildPoints: '900719925474099312345' }],
      [102, { guildPoints: '20' }],
    ])

    const { job, queue, waits } = createHarness(answers)

    const week = await scheduleWeek(queue, 'stored')

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).toBe('succeeded')

    expect(await readSnapshots(week)).toEqual([
      { clanId: 101, guildPoints: '900719925474099312345' },
      { clanId: 102, guildPoints: '20' },
    ])

    const [profile] = await database.sql<{ clanName: string; guildPoints: string; lifetimeXp: string }[]>`
      SELECT clan_name AS "clanName", guild_points::text AS "guildPoints", clan_lifetime_xp::text AS "lifetimeXp"
      FROM clans.profiles WHERE clan_id = 102
    `

    expect(profile).toEqual({ clanName: 'Fresh 102', guildPoints: '20', lifetimeXp: '15' })
    expect(waits).toEqual([500])
    expect(await isWeekCompleted(week)).toBe(true)
  })

  test('gives the slot back after a slice and resumes after the last stored guild', async () => {
    for (const clanId of [201, 202, 203]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [201, { guildPoints: '1' }],
      [202, { guildPoints: '2' }],
      [203, { guildPoints: '3' }],
    ])

    const { job, queue, sourceCalls } = createHarness(answers, 2)

    const week = await scheduleWeek(queue, 'sliced')

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).not.toBe('succeeded')
    expect(sourceCalls).toEqual([201, 202])
    expect(await isWeekCompleted(week)).toBe(false)

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).toBe('succeeded')
    expect(sourceCalls).toEqual([201, 202, 203])
    expect(await readSnapshots(week)).toHaveLength(3)
    expect(await isWeekCompleted(week)).toBe(true)
  })

  test('skips a guild the source no longer has or sends unreadable, and finishes the others', async () => {
    for (const clanId of [301, 302, 303]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [301, 'not-found'],
      [302, 'invalid'],
      [303, { guildPoints: '9' }],
    ])

    const { job, queue } = createHarness(answers)

    const week = await scheduleWeek(queue, 'skipped')

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).toBe('succeeded')
    expect(await readSnapshots(week)).toEqual([{ clanId: 303, guildPoints: '9' }])
    expect(await isWeekCompleted(week)).toBe(true)
  })

  test('retries a failed fetch without repeating the guilds already stored', async () => {
    for (const clanId of [401, 402]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [401, { guildPoints: '4' }],
      [402, 'fail-once'],
    ])

    const { job, queue, sourceCalls } = createHarness(answers)

    const week = await scheduleWeek(queue, 'retried')

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting, retryDelayMs: 0 })).toBe('retry')
    expect(await isWeekCompleted(week)).toBe(false)

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting, retryDelayMs: 0 })).toBe('succeeded')
    expect(sourceCalls).toEqual([401, 402, 402])
    expect(await readSnapshots(week)).toEqual([
      { clanId: 401, guildPoints: '4' },
      { clanId: 402, guildPoints: '77' },
    ])
  })

  test('files a run that missed windows under the latest window, the week it actually covers', async () => {
    const { job, queue } = createHarness(new Map())
    const firstDueAt = new Date(Date.now() - 2 * weekMs - 60_000).toISOString()
    const latestWindow = new Date(Date.parse(firstDueAt) + 2 * weekMs).toISOString().slice(0, 10)

    await scheduleWeek(queue, 'late', firstDueAt)

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).toBe('succeeded')
    expect(await isWeekCompleted(latestWindow)).toBe(true)
  })

  test('does not touch the source for a week that already finished', async () => {
    await storeGuild(501)

    const answers = new Map<number, SourceAnswer>([[501, { guildPoints: '5' }]])
    const { job, queue, sourceCalls } = createHarness(answers)

    const dueAt = new Date(Date.now() - 60_000).toISOString()

    await scheduleWeek(queue, 'finished', dueAt)
    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).toBe('succeeded')

    await scheduleWeek(queue, 'finished-again', dueAt)
    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).toBe('succeeded')

    expect(sourceCalls).toEqual([501])
  })
})
