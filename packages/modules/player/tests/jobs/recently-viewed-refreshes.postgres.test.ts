import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { interactivePlayerRefreshContract } from '@brawltome/player'
import { createPostgresRefreshOperations, refreshOperationsModule } from '@brawltome/queue'
import postgres from 'postgres'
import { reserveInteractivePlayerRefresh } from '../../jobs/player-refresh-reservation'
import {
  activeRecentlyViewedRefreshes,
  enqueueRecentlyViewedRefreshes,
  recentFreshnessAttempts,
  refreshRequestDemand,
} from '../../jobs/recently-viewed-refreshes'

let database: TestDatabase
let connectionString = ''

const admission = {
  totalConcurrency: 8,
  interactiveReservation: 2,
  classConcurrency: {
    interactive: 4,
    'primary-monitoring': 2,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 2,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
} as const

beforeAll(async () => {
  database = await createTestDatabase({ label: 'freshness_operations', modules: [refreshOperationsModule] })
  connectionString = database.connectionString
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

async function insertVisitorRefresh(
  sql: ReturnType<typeof postgres>,
  brawlhallaId: number,
  ageDays: number,
  settled: boolean,
  source = 'interactive-api',
  errorCode?: string,
): Promise<void> {
  const id = randomUUID()

  await sql`
    INSERT INTO refresh_operations.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts, created_at)
    VALUES
      (${id}, ${id}, 'interactive-player-refresh', ${`visit:${id}`}, ${`visit:${id}`}, 'interactive',
       ${sql.json({ brawlhallaId, staleSections: ['ranked'] })}, ${sql.json({ source })}, 4,
       clock_timestamp() - make_interval(days => ${ageDays}))
  `

  if (errorCode) {
    await sql`
      UPDATE refresh_operations.operations
      SET status = 'dead_letter', completed_at = clock_timestamp(), last_error = ${sql.json({ code: errorCode })}
      WHERE id = ${id}
    `
  } else if (settled) {
    await sql`
      UPDATE refresh_operations.operations
      SET status = 'succeeded', completed_at = clock_timestamp()
      WHERE id = ${id}
    `
  }
}

describe('Recently viewed freshness operations', () => {
  test('counts request days per player and the planner attempts within the window', async () => {
    const control = postgres(connectionString, { max: 1 })

    try {
      for (let index = 0; index < 3; index++) await insertVisitorRefresh(control, 10, 1, true)
      await insertVisitorRefresh(control, 10, 3, true)
      await insertVisitorRefresh(control, 11, 10, true)
      await insertVisitorRefresh(control, 12, 40, true)
      // Overlay lookups and rate-limited or abandoned requests are not profile views.
      await insertVisitorRefresh(control, 13, 1, true, 'desktop-api')
      await insertVisitorRefresh(control, 14, 1, false, 'interactive-api', 'actor_rate_limited')
      await insertVisitorRefresh(control, 14, 1, false, 'interactive-api', 'admission_reservation_expired')
      await enqueueRecentlyViewedRefreshes(database, [11])

      await control`
        UPDATE refresh_operations.operations SET status = 'dead_letter', completed_at = clock_timestamp()
        WHERE provenance->>'source' = 'freshness-planner'
      `

      // Distinct days, not request counts: three requests on one day count once.
      const demand = await refreshRequestDemand(database, { windowDays: 30 })

      expect(demand.sort((left, right) => left.brawlhallaId - right.brawlhallaId)).toEqual([
        { brawlhallaId: 10, viewDays: 2 },
        { brawlhallaId: 11, viewDays: 1 },
      ])

      expect(await recentFreshnessAttempts(database, { windowDays: 30 })).toEqual([
        { brawlhallaId: 11, lastPlannedAt: expect.any(Date), lastFailedAt: expect.any(Date) },
      ])
    } finally {
      await control.end()
    }
  })

  test('enqueues background refreshes once per player and skips players with an active refresh', async () => {
    const control = postgres(connectionString, { max: 1 })
    const operations = createPostgresRefreshOperations({ database }, { jobs: [interactivePlayerRefreshContract] })

    try {
      await insertVisitorRefresh(control, 30, 0, false)

      expect(await enqueueRecentlyViewedRefreshes(database, [20, 21, 30])).toEqual([20, 21])
      expect(await enqueueRecentlyViewedRefreshes(database, [20])).toEqual([])
      expect(await activeRecentlyViewedRefreshes(database)).toBe(2)

      const [row] = await control<{ work_class: string; payload: unknown; resource_key: string }[]>`
        SELECT work_class, payload, resource_key FROM refresh_operations.operations
        WHERE provenance->>'source' = 'freshness-planner' AND payload->>'brawlhallaId' = '20'
      `

      expect(row).toEqual({
        work_class: 'primary-monitoring',
        payload: { cohort: 'recently-viewed', brawlhallaId: 20, staleSections: ['ranked', 'stats'] },
        resource_key: 'player:20',
      })

      // Interactive work is claimed first, so settle the visitor's refresh to reach the background one.
      await control`
        UPDATE refresh_operations.operations SET status = 'succeeded', completed_at = clock_timestamp()
        WHERE work_class = 'interactive'
      `

      const lease = await operations.claim('worker', 1_000, admission)

      expect(lease).toMatchObject({
        kind: 'interactive-player-refresh',
        workClass: 'primary-monitoring',
        payload: { cohort: 'recently-viewed', staleSections: ['ranked', 'stats'] },
      })
    } finally {
      await control.end()
    }
  })

  test('rejects primary-monitoring refreshes that have neither an assignment nor the cohort', () => {
    const payload = { brawlhallaId: 40, staleSections: ['ranked', 'stats'] }

    expect(() => interactivePlayerRefreshContract.parsePayload(payload, 'primary-monitoring')).toThrow(
      'needs an assignmentId or the recently viewed cohort',
    )
  })

  test('promotes a queued background refresh when a visitor asks for the same player', async () => {
    const control = postgres(connectionString, { max: 1 })

    try {
      const activeBefore = await activeRecentlyViewedRefreshes(database)

      expect(await enqueueRecentlyViewedRefreshes(database, [50])).toEqual([50])

      const reservation = await reserveInteractivePlayerRefresh(database, {
        brawlhallaId: 50,
        dedupeKey: 'player:50:visit',
        operationKey: `player:50:${randomUUID()}`,
        staleSections: ['ranked'],
        provenance: { source: 'interactive-api' },
        reservationTtlSeconds: 30,
      })

      const [background] = await control<{ id: string; work_class: string }[]>`
        SELECT id, work_class FROM refresh_operations.operations
        WHERE provenance->>'source' = 'freshness-planner' AND payload->>'brawlhallaId' = '50'
      `

      expect(reservation).toEqual({ outcome: 'already-active', operationId: background.id })
      expect(background.work_class).toBe('interactive')
      // The promoted refresh no longer occupies a background slot.
      expect(await activeRecentlyViewedRefreshes(database)).toBe(activeBefore)
    } finally {
      await control.end()
    }
  })
})
