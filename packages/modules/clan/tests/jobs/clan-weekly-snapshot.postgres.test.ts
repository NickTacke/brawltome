import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  type CreateClanWeeklySnapshotSchedule,
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  type PostgresRefreshOperations,
  queueModule,
} from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { createTelemetry } from '@brawltome/telemetry'
import { createPostgresWeeklySnapshots } from '../../db/postgres-weekly-snapshots'
import { clanModule } from '../../index'
import { clanWeeklySnapshotOutageGuilds, createClanWeeklySnapshotJob } from '../../jobs/clan-weekly-snapshot-job'
import { reconcileClanWeeklySnapshotSchedule } from '../../jobs/clan-weekly-snapshot-schedule'

const weekMs = 7 * 24 * 60 * 60 * 1000

type SourceAnswer =
  | { guildPoints: string; rank?: number }
  | { failures: number; guildPoints: string }
  | 'not-found'
  | 'invalid'
  | 'nul-text'
  | 'unavailable'
  | 'rate-limited'

type Harness = {
  job: ReturnType<typeof createClanWeeklySnapshotJob>
  queue: PostgresRefreshOperations
  sourceCalls: number[]
  waits: number[]
  retryWaits: number[]
  pauses: string[]
  // runs after the source answers and before the job writes, the window in which a lease can be lost
  hooks: { afterSourceCall(clanId: number): Promise<void> }
  // how far ahead of the real time the job's clock runs
  clock: { offsetMs: number }
  sourceAdmission: { admitSource(): Promise<{ outcome: 'admitted' }>; pauseSource(domain: string): Promise<void> }
}

// the shapes the Brawlhalla client throws, without depending on it
class SourceHttpError extends Error {
  readonly domain = 'brawlhalla-v1'

  constructor(readonly status: number) {
    super(`Brawlhalla API error: ${status}`)
  }
}

class SourceRateLimitError extends Error {
  readonly retryAfterMs = 6_000
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

function answerFor(answers: Map<number, SourceAnswer>, clanId: number, failedCalls: Map<number, number>) {
  const answer = answers.get(clanId)

  if (answer === undefined || answer === 'not-found') return null

  if (answer === 'invalid') return { guild_id: clanId }

  if (answer === 'nul-text') return { ...guildStats(clanId, '6'), notice: 'Join\u0000 us', tags: ['pvp\u0000'] }

  if (answer === 'unavailable') throw new SourceHttpError(503)

  if (answer === 'rate-limited') throw new SourceRateLimitError(`Brawlhalla API rate limited for guild ${clanId}`)

  if ('failures' in answer && (failedCalls.get(clanId) ?? 0) < answer.failures) {
    failedCalls.set(clanId, (failedCalls.get(clanId) ?? 0) + 1)
    throw new Error(`Brawlhalla API timeout for guild ${clanId}`)
  }

  const rank = 'rank' in answer ? answer.rank : undefined

  return { ...guildStats(clanId, answer.guildPoints), rank }
}

function createHarness(answers: Map<number, SourceAnswer>, sliceGuilds = 100): Harness {
  const sourceCalls: number[] = []
  const waits: number[] = []
  const retryWaits: number[] = []
  const pauses: string[] = []
  const failedCalls = new Map<number, number>()
  const hooks: Harness['hooks'] = { afterSourceCall: async () => {} }
  const clock: Harness['clock'] = { offsetMs: 0 }

  const getGuildStatsV1 = async (clanId: number) => {
    sourceCalls.push(clanId)

    const answer = answerFor(answers, clanId, failedCalls)

    await hooks.afterSourceCall(clanId)

    return answer
  }

  const job = createClanWeeklySnapshotJob({
    snapshots: createPostgresWeeklySnapshots(database),
    createAdmittedSource: (admitSource) => ({
      getGuildStatsV1: async (clanId: number) => {
        await admitSource('brawlhalla-v1')

        return getGuildStatsV1(clanId)
      },
    }),
    sliceGuilds,
    guildDelayMs: 500,
    waitBetweenGuilds: async (delayMs) => {
      waits.push(delayMs)
    },
    waitBeforeGuildRetry: async (delayMs) => {
      retryWaits.push(delayMs)
    },
    retryTimings: { retryDelayMs: 0, sourceUnavailableRetryMs: 60_000 },
    now: () => new Date(Date.now() + clock.offsetMs),
    telemetry: createTelemetry({ service: 'operations-worker', drainIntervalMs: 0 }),
  })

  const queue = createPostgresRefreshOperations({ database }, { jobs: [job] })

  const sourceAdmission = {
    admitSource: async () => ({ outcome: 'admitted' }) as const,
    pauseSource: async (domain: string) => {
      pauses.push(domain)
    },
  }

  return { job, queue, sourceCalls, waits, retryWaits, pauses, hooks, clock, sourceAdmission }
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

async function readProfileCheck(clanId: number) {
  const [check] = await database.sql<{ checkProvenance: unknown; lastSuccessProvenance: unknown }[]>`
    SELECT check_provenance AS "checkProvenance", last_success_provenance AS "lastSuccessProvenance"
    FROM clans.profile_state WHERE clan_id = ${clanId}
  `

  return check ?? null
}

async function readOperation() {
  const [operation] = await database.sql<{ attemptCount: number; status: string; errorCode: string | null }[]>`
    SELECT attempt_count AS "attemptCount", status, last_error->>'code' AS "errorCode"
    FROM queue.operations WHERE kind = 'clan-weekly-snapshot' ORDER BY created_at DESC LIMIT 1
  `

  return operation
}

// moves the start of the outage the run recorded back, as if V1 had been failing it that long
async function backdateSourceDown(weekStarting: string, hours: number): Promise<void> {
  await database.sql`
    UPDATE clans.weekly_snapshot_runs
    SET source_down_since = clock_timestamp() - make_interval(hours => ${hours})
    WHERE week_starting = ${weekStarting}
  `
}

async function readSourceDownMinutes(weekStarting: string): Promise<number | null> {
  const [run] = await database.sql<{ minutes: number | null }[]>`
    SELECT (extract(epoch FROM clock_timestamp() - source_down_since) / 60)::float8 AS minutes
    FROM clans.weekly_snapshot_runs WHERE week_starting = ${weekStarting}
  `

  return run?.minutes ?? null
}

// another worker claims the operation, as it does once this worker's lease has run out
async function takeLeaseOver(): Promise<void> {
  await database.sql`
    UPDATE queue.operations SET lease_owner = 'replacement-worker', lease_token = lease_token + 1
    WHERE kind = 'clan-weekly-snapshot' AND status = 'leased'
  `
}

// the replacement worker stops without settling, so the next claim takes the operation over again
async function expireLease(): Promise<void> {
  await database.sql`
    UPDATE queue.operations SET lease_expires_at = clock_timestamp()
    WHERE kind = 'clan-weekly-snapshot' AND status = 'leased'
  `
}

async function readStoredGuildPoints(clanId: number): Promise<string | null> {
  const [profile] = await database.sql<{ guildPoints: string | null }[]>`
    SELECT guild_points::text AS "guildPoints" FROM clans.profiles WHERE clan_id = ${clanId}
  `

  return profile?.guildPoints ?? null
}

async function readLastClanId(weekStarting: string): Promise<number | null> {
  const [run] = await database.sql<{ lastClanId: number }[]>`
    SELECT last_clan_id AS "lastClanId" FROM clans.weekly_snapshot_runs WHERE week_starting = ${weekStarting}
  `

  return run?.lastClanId ?? null
}

async function makeOperationDue(): Promise<void> {
  await database.sql`UPDATE queue.operations SET available_at = clock_timestamp() WHERE kind = 'clan-weekly-snapshot'`
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

describe('clan weekly snapshot schedule', () => {
  test('keeps the existing schedule when the worker reconciles the same definition again', async () => {
    const schedule: CreateClanWeeklySnapshotSchedule = {
      kind: 'clan-weekly-snapshot',
      scheduleKey: 'test:weekly-snapshot:reconciled',
      operationKeyPrefix: 'test:weekly-snapshot:reconciled',
      workClass: 'maintenance',
      intervalMs: weekMs,
      firstDueAt: '2026-11-19T10:30:00.000Z',
      payload: {},
      provenance: { source: 'integration-test' },
      maxAttempts: 20,
    }

    const created = await reconcileClanWeeklySnapshotSchedule(database, schedule)
    const reconciled = await reconcileClanWeeklySnapshotSchedule(database, schedule)

    expect(created.outcome).toBe('created')
    expect(reconciled).toEqual({ outcome: 'already-exists', scheduleId: created.scheduleId })
  })
})

describe('clan weekly snapshot job', () => {
  test('finishes the week with no snapshots when no guild is stored', async () => {
    const { job, queue, sourceCalls, sourceAdmission } = createHarness(new Map())

    const week = await scheduleWeek(queue, 'empty')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
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

    const { job, queue, waits, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'stored')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')

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

  test('keeps the rank the source sent with the points, if it sent one', async () => {
    for (const clanId of [111, 112]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [111, { guildPoints: '30', rank: 12 }],
      [112, { guildPoints: '20' }],
    ])

    const { job, queue, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'ranked')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')

    const ranks = await database.sql<{ clanId: number; sourceRank: number | null }[]>`
      SELECT clan_id AS "clanId", source_rank AS "sourceRank"
      FROM clans.weekly_snapshots WHERE week_starting = ${week} ORDER BY clan_id
    `

    expect([...ranks]).toEqual([
      { clanId: 111, sourceRank: 12 },
      { clanId: 112, sourceRank: null },
    ])
  })

  test('marks the profiles it publishes as coming from the weekly snapshot', async () => {
    await storeGuild(121)

    const { job, queue, sourceAdmission } = createHarness(new Map([[121, { guildPoints: '5' }]]))

    await scheduleWeek(queue, 'provenance')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')

    expect(await readProfileCheck(121)).toEqual({
      checkProvenance: { source: 'v1-guild-stats', outcome: 'success', trigger: 'weekly-snapshot' },
      lastSuccessProvenance: { source: 'v1-guild-stats', outcome: 'success', trigger: 'weekly-snapshot' },
    })
  })

  test('gives the slot back after a slice and resumes after the last stored guild', async () => {
    for (const clanId of [201, 202, 203]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [201, { guildPoints: '1' }],
      [202, { guildPoints: '2' }],
      [203, { guildPoints: '3' }],
    ])

    const { job, queue, sourceCalls, sourceAdmission } = createHarness(answers, 2)

    const week = await scheduleWeek(queue, 'sliced')

    expect(await runJobOnce(queue, job, { sourceAdmission })).not.toBe('succeeded')
    expect(sourceCalls).toEqual([201, 202])
    expect(await isWeekCompleted(week)).toBe(false)

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
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

    const { job, queue, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'skipped')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toEqual([{ clanId: 303, guildPoints: '9' }])
    expect(await isWeekCompleted(week)).toBe(true)

    const failedCheck = { source: 'v1-guild-stats', outcome: 'ambiguous-failure', trigger: 'weekly-snapshot' }

    expect((await readProfileCheck(301))?.checkProvenance).toEqual(failedCheck)
    expect((await readProfileCheck(302))?.checkProvenance).toEqual(failedCheck)
  })

  test('stores a guild whose text holds characters Postgres cannot store, without them', async () => {
    for (const clanId of [311, 312]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [311, 'nul-text'],
      [312, { guildPoints: '9' }],
    ])

    const { job, queue, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'nul-text')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')

    expect(await readSnapshots(week)).toEqual([
      { clanId: 311, guildPoints: '6' },
      { clanId: 312, guildPoints: '9' },
    ])

    const [profile] = await database.sql<{ notice: string; tags: string[] }[]>`
      SELECT notice, tags FROM clans.profiles WHERE clan_id = 311
    `

    expect(profile).toEqual({ notice: 'Join us', tags: ['pvp'] })
  })

  test('retries a guild that fails in place and stores it in the same attempt', async () => {
    for (const clanId of [401, 402]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [401, { guildPoints: '4' }],
      [402, { failures: 2, guildPoints: '77' }],
    ])

    const { job, queue, sourceCalls, retryWaits, pauses, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'retried')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(sourceCalls).toEqual([401, 402, 402, 402])
    expect(retryWaits).toEqual([500, 2_000])
    expect(pauses).toEqual([])

    expect(await readSnapshots(week)).toEqual([
      { clanId: 401, guildPoints: '4' },
      { clanId: 402, guildPoints: '77' },
    ])
  })

  test('skips a guild that keeps failing, records the failed check and leaves V1 alone', async () => {
    for (const clanId of [411, 412]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [411, 'unavailable'],
      [412, { guildPoints: '8' }],
    ])

    const { job, queue, sourceCalls, pauses, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'failing-guild')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(sourceCalls).toEqual([411, 411, 411, 412])
    expect(pauses).toEqual([])
    expect(await readSnapshots(week)).toEqual([{ clanId: 412, guildPoints: '8' }])
    expect(await isWeekCompleted(week)).toBe(true)

    expect((await readProfileCheck(411))?.checkProvenance).toEqual({
      source: 'v1-guild-stats',
      outcome: 'ambiguous-failure',
      trigger: 'weekly-snapshot',
    })
  })

  test('skips a failing guild at the end of the run and still finishes the week', async () => {
    await storeGuild(421)

    const { job, queue, sourceAdmission } = createHarness(new Map([[421, 'unavailable']]))

    const week = await scheduleWeek(queue, 'failing-last')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toEqual([])
    expect(await isWeekCompleted(week)).toBe(true)
  })

  test('fetches the guilds failing at the end of a full slice again in the next slice', async () => {
    const clanIds = Array.from({ length: 12 }, (_, index) => 701 + index)

    for (const clanId of clanIds) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>(clanIds.map((clanId) => [clanId, { guildPoints: `${clanId}` }]))

    for (const clanId of clanIds.slice(3)) answers.set(clanId, 'unavailable')

    const { job, queue, sourceAdmission } = createHarness(answers, 6)

    const week = await scheduleWeek(queue, 'failing-slice-end')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')
    expect(await readProfileCheck(704)).toBeNull()
    expect(await readProfileCheck(706)).toBeNull()

    for (const clanId of clanIds) answers.set(clanId, { guildPoints: `${clanId}` })

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')
    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toHaveLength(clanIds.length)
  })

  test('skips a full slice of failing guilds rather than fetching it forever', async () => {
    for (const clanId of [721, 722, 723]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [721, 'unavailable'],
      [722, 'unavailable'],
      [723, { guildPoints: '7' }],
    ])

    const { job, queue, sourceAdmission } = createHarness(answers, 2)

    const week = await scheduleWeek(queue, 'failing-slice')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')
    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toEqual([{ clanId: 723, guildPoints: '7' }])
  })

  test('defers the run without pausing V1 when guilds in a row keep failing, then picks up the first of them', async () => {
    const clanIds = Array.from({ length: clanWeeklySnapshotOutageGuilds + 1 }, (_, index) => 431 + index)

    for (const clanId of clanIds) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>(clanIds.map((clanId) => [clanId, 'unavailable']))
    const { job, queue, pauses, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'outage')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')
    expect(pauses).toEqual([])
    expect(await readOperation()).toMatchObject({ attemptCount: 0, errorCode: 'clan_weekly_snapshot_source_down' })
    expect(await readProfileCheck(431)).toBeNull()

    for (const clanId of clanIds) answers.set(clanId, { guildPoints: `${clanId}` })
    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toHaveLength(clanIds.length)
  })

  test('spends an attempt when admission fails, since that is the database and not V1', async () => {
    const clanIds = Array.from({ length: clanWeeklySnapshotOutageGuilds + 1 }, (_, index) => 741 + index)

    for (const clanId of clanIds) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>(clanIds.map((clanId) => [clanId, { guildPoints: `${clanId}` }]))
    const { job, queue, sourceCalls, sourceAdmission } = createHarness(answers)

    const failingAdmission = {
      ...sourceAdmission,
      admitSource: async (): Promise<{ outcome: 'admitted' }> => {
        throw new Error('connection to the queue database was terminated')
      },
    }

    const week = await scheduleWeek(queue, 'admission-down')

    expect(await runJobOnce(queue, job, { sourceAdmission: failingAdmission })).toBe('retry')
    expect(sourceCalls).toEqual([])
    expect(await readOperation()).toMatchObject({ attemptCount: 1, errorCode: 'clan_weekly_snapshot_failed' })
    expect(await readProfileCheck(741)).toBeNull()

    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toHaveLength(clanIds.length)
  })

  test('skips the first of the failing guilds once they outlast the outage limit, then moves on', async () => {
    const failingClanIds = Array.from({ length: clanWeeklySnapshotOutageGuilds }, (_, index) => 602 + index)
    const lastClanId = 602 + clanWeeklySnapshotOutageGuilds

    for (const clanId of [601, ...failingClanIds, lastClanId]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>(failingClanIds.map((clanId) => [clanId, 'unavailable']))

    answers.set(601, { guildPoints: '1' })
    answers.set(lastClanId, { guildPoints: '2' })

    const { job, queue, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'outage-outlasted')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')

    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')
    expect(await readProfileCheck(602)).toBeNull()

    await backdateSourceDown(week, 7)
    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')
    expect((await readProfileCheck(602))?.checkProvenance).toMatchObject({ outcome: 'ambiguous-failure' })
    expect(await readProfileCheck(603)).toBeNull()
    expect(await readOperation()).toMatchObject({ attemptCount: 0 })

    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')

    expect(await readSnapshots(week)).toEqual([
      { clanId: 601, guildPoints: '1' },
      { clanId: lastClanId, guildPoints: '2' },
    ])
  })

  test('starts the outage clock again once a guild answers', async () => {
    const clanIds = Array.from({ length: clanWeeklySnapshotOutageGuilds + 2 }, (_, index) => 621 + index)

    for (const clanId of clanIds) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>(clanIds.map((clanId) => [clanId, 'unavailable']))
    const { job, queue, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'outage-ended')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')

    await backdateSourceDown(week, 7)
    answers.set(621, { guildPoints: '1' })
    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')
    expect(await readProfileCheck(622)).toBeNull()
    expect(await readSourceDownMinutes(week)).toBeLessThan(1)

    for (const clanId of clanIds) answers.set(clanId, { guildPoints: `${clanId}` })
    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toHaveLength(clanIds.length)
  })

  test('defers a rate limited call without spending an attempt', async () => {
    await storeGuild(441)

    const answers = new Map<number, SourceAnswer>([[441, 'rate-limited']])
    const { job, queue, sourceCalls, sourceAdmission } = createHarness(answers)

    const week = await scheduleWeek(queue, 'rate-limited')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')
    expect(sourceCalls).toEqual([441])
    expect(await readOperation()).toMatchObject({ attemptCount: 0, errorCode: 'source_rate_limited' })

    answers.set(441, { guildPoints: '44' })
    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toEqual([{ clanId: 441, guildPoints: '44' }])
  })

  test('files a run that missed windows under the latest window, the week it actually covers', async () => {
    const { job, queue, sourceAdmission } = createHarness(new Map())
    const firstDueAt = new Date(Date.now() - 2 * weekMs - 60_000).toISOString()
    const latestWindow = new Date(Date.parse(firstDueAt) + 2 * weekMs).toISOString().slice(0, 10)

    await scheduleWeek(queue, 'late', firstDueAt)

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await isWeekCompleted(latestWindow)).toBe(true)
  })

  test('writes nothing for a guild it fetched after another worker took the lease over', async () => {
    await storeGuild(811)

    const { job, queue, hooks, sourceAdmission } = createHarness(new Map([[811, { guildPoints: '999' }]]))

    hooks.afterSourceCall = takeLeaseOver

    const week = await scheduleWeek(queue, 'lease-lost-store')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('lease_lost')
    expect(await readSnapshots(week)).toEqual([])
    expect(await readStoredGuildPoints(811)).toBe('1')
    expect(await readProfileCheck(811)).toBeNull()
    expect(await readLastClanId(week)).toBe(0)
    expect(await isWeekCompleted(week)).toBe(false)

    hooks.afterSourceCall = async () => {}

    await expireLease()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await readSnapshots(week)).toEqual([{ clanId: 811, guildPoints: '999' }])
  })

  test('skips no guild it fetched after another worker took the lease over', async () => {
    await storeGuild(821)

    const { job, queue, hooks, sourceAdmission } = createHarness(new Map([[821, 'not-found']]))

    hooks.afterSourceCall = takeLeaseOver

    const week = await scheduleWeek(queue, 'lease-lost-skip')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('lease_lost')
    expect(await readProfileCheck(821)).toBeNull()
    expect(await readLastClanId(week)).toBe(0)
    expect(await isWeekCompleted(week)).toBe(false)

    hooks.afterSourceCall = async () => {}

    await expireLease()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(await isWeekCompleted(week)).toBe(true)
  })

  test('stops fetching an unfinished week once the next window is due, and leaves the week unfinished', async () => {
    for (const clanId of [901, 902]) await storeGuild(clanId)

    const answers = new Map<number, SourceAnswer>([
      [901, { guildPoints: '1' }],
      [902, { guildPoints: '2' }],
    ])

    const { job, queue, sourceCalls, clock, sourceAdmission } = createHarness(answers, 1)

    const week = await scheduleWeek(queue, 'next-window-due')

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('retry')

    clock.offsetMs = weekMs
    await makeOperationDue()

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(sourceCalls).toEqual([901])
    expect(await readSnapshots(week)).toEqual([{ clanId: 901, guildPoints: '1' }])
    expect(await isWeekCompleted(week)).toBe(false)
  })

  test('stops a replayed dead letter whose next window is already due, without fetching', async () => {
    await storeGuild(911)

    const { job, queue, sourceCalls, clock, sourceAdmission } = createHarness(new Map([[911, { guildPoints: '1' }]]))

    const failingAdmission = {
      ...sourceAdmission,
      admitSource: async (): Promise<{ outcome: 'admitted' }> => {
        throw new Error('connection to the queue database was terminated')
      },
    }

    const week = await scheduleWeek(queue, 'stale-replay')

    await database.sql`UPDATE queue.operations SET max_attempts = 1 WHERE kind = 'clan-weekly-snapshot' AND status = 'pending'`

    expect(await runJobOnce(queue, job, { sourceAdmission: failingAdmission })).toBe('dead_letter')

    const deadLetters = createPostgresDeadLetterOperations(database, {
      replayGuards: new Map(),
      describeEffects: new Map(),
    })

    const [deadLetter] = await database.sql<{ id: string }[]>`
      SELECT id FROM queue.operations WHERE kind = 'clan-weekly-snapshot' AND status = 'dead_letter'
    `

    if (!deadLetter) throw new Error('the weekly snapshot operation did not dead-letter')

    await deadLetters.replayDeadLetter({ operationId: deadLetter.id, actorId: 'operator:test', reason: 'late replay' })
    clock.offsetMs = weekMs + 60_000

    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')
    expect(sourceCalls).toEqual([])
    expect(await isWeekCompleted(week)).toBe(false)
  })

  test('does not touch the source for a week that already finished', async () => {
    await storeGuild(501)

    const answers = new Map<number, SourceAnswer>([[501, { guildPoints: '5' }]])
    const { job, queue, sourceCalls, sourceAdmission } = createHarness(answers)

    const dueAt = new Date(Date.now() - 60_000).toISOString()

    await scheduleWeek(queue, 'finished', dueAt)
    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')

    await scheduleWeek(queue, 'finished-again', dueAt)
    expect(await runJobOnce(queue, job, { sourceAdmission })).toBe('succeeded')

    expect(sourceCalls).toEqual([501])
  })
})
