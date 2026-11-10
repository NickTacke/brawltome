import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { analyticsModule, createPostgresDailySalts } from '@brawltome/analytics'
import type { Database } from '@brawltome/foundation'
import { createTestDatabase, openTestClient, type TestDatabase } from '@brawltome/foundation/testing'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { createDailyVisitorKeys, createServerBoundSalts, createVisitLimiter, recordSiteVisit } from '../src/visits'

const address = '198.51.100.20'
const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'
const visitId = 'b'.repeat(32)
const serverSecret = 'c'.repeat(32)
const noon = Date.UTC(2026, 10, 10, 12)
const nextNoon = Date.UTC(2026, 10, 11, 12)

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'daily_visitor_key', modules: [analyticsModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

beforeEach(async () => {
  await database.sql`TRUNCATE analytics.daily_salts`
})

// an api process: its own key maker, with nothing in memory yet, over the database every process shares
function startProcess(client: Database, startMs: number) {
  let nowMs = startMs
  const storedSaltFor = createPostgresDailySalts(client).saltFor
  const loadSalt = createServerBoundSalts({ serverSecret, storedSaltFor })
  const keys = createDailyVisitorKeys({ now: () => nowMs, loadSalt, readTimeoutMs: 5_000 })

  return { keys, moveTo: (timeMs: number) => (nowMs = timeMs) }
}

async function storedDays(): Promise<string[]> {
  const rows = await database.sql<{ day: string }[]>`
    SELECT day::text AS day FROM analytics.daily_salts ORDER BY day
  `

  return rows.map(({ day }) => day)
}

describe('daily visitor keys over postgres', () => {
  test('a visitor keeps their key when the api restarts during the day', async () => {
    const beforeDeploy = await startProcess(database, noon).keys.forToday()
    const afterDeploy = await startProcess(database, noon + 3_600_000).keys.forToday()

    expect(afterDeploy.keyFor(address, browser)).toBe(beforeDeploy.keyFor(address, browser))
    expect(afterDeploy.visitKeyFor(visitId)).toBe(beforeDeploy.visitKeyFor(visitId))
  })

  test('two api processes that start together give a visitor the same key', async () => {
    const otherClient = openTestClient(database.connectionString)

    try {
      const [oldRelease, newRelease] = await Promise.all([
        startProcess(database, noon).keys.forToday(),
        startProcess(otherClient, noon).keys.forToday(),
      ])

      expect(newRelease.keyFor(address, browser)).toBe(oldRelease.keyFor(address, browser))
    } finally {
      await otherClient.close()
    }
  })

  test('the next day gives a new key and deletes the salt of the day before', async () => {
    const { keys, moveTo } = startProcess(database, noon)
    const today = await keys.forToday()

    expect(await storedDays()).toEqual(['2026-11-10'])

    moveTo(nextNoon)
    const tomorrow = await keys.forToday()

    expect(tomorrow.keyFor(address, browser)).not.toBe(today.keyFor(address, browser))
    expect(await storedDays()).toEqual(['2026-11-11'])
  })

  test('a day revisited later never gets its old key back, the secret is gone', async () => {
    const { keys, moveTo } = startProcess(database, noon)
    const first = (await keys.forToday()).keyFor(address, browser)

    moveTo(nextNoon)
    await keys.forToday()
    moveTo(noon)

    expect((await keys.forToday()).keyFor(address, browser)).not.toBe(first)
  })

  test('a page view is dropped, not failed, while the database is unreachable', async () => {
    const unreachable = openTestClient(database.connectionString)

    await unreachable.close()

    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'api', sink, drainIntervalMs: 0 })

    const dependencies = {
      visitorKeys: startProcess(unreachable, noon).keys,
      limiter: createVisitLimiter(120, Date.now),
      eventLimiter: createVisitLimiter(120, Date.now),
    }

    const visitor = { telemetry, clientIp: address, userAgent: browser, isBot: false }
    const visit = { visitId, path: '/player/7', viewportWidth: 1280 }

    expect(await recordSiteVisit(dependencies, visitor, visit)).toEqual({ recorded: false })

    const dropped = telemetry.metrics.snapshot().find((metric) => metric.name === 'analytics_events_dropped_total')

    expect(dropped?.series).toMatchObject([{ labels: { reason: 'salt_unavailable' }, value: 1 }])
    expect(await storedDays()).toEqual([])
  })
})
