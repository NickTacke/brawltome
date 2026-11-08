import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { countActive, readAttemptHistory, refreshOperationsModule } from '@brawltome/refresh-operations'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_history', modules: [refreshOperationsModule] })
})

afterAll(async () => {
  await database?.drop()
})

type InsertedRefresh = {
  brawlhallaId: number
  workClass?: 'interactive' | 'primary-monitoring'
  source?: string
  ageDays?: number
  status?: 'pending' | 'succeeded' | 'dead_letter'
  lastErrorCode?: string
  cohort?: string
}

async function insertRefresh(refresh: InsertedRefresh): Promise<string> {
  const id = randomUUID()
  const workClass = refresh.workClass ?? 'interactive'

  const payload =
    workClass === 'primary-monitoring'
      ? {
          cohort: refresh.cohort ?? 'recently-viewed',
          brawlhallaId: refresh.brawlhallaId,
          staleSections: ['ranked', 'stats'],
        }
      : { brawlhallaId: refresh.brawlhallaId, staleSections: ['ranked'] }

  await database.sql`
    INSERT INTO refresh_operations.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts, created_at)
    VALUES
      (${id}, ${id}, 'interactive-player-refresh', ${`history:${id}`}, ${`history:${id}`}, ${workClass},
       ${database.sql.json(payload)}, ${database.sql.json({ source: refresh.source ?? 'interactive-api' })}, 4,
       clock_timestamp() - make_interval(days => ${refresh.ageDays ?? 0}))
  `

  const status = refresh.status ?? 'succeeded'
  const failure = refresh.lastErrorCode ? database.sql.json({ code: refresh.lastErrorCode }) : null

  if (status === 'pending') return id

  await database.sql`
    UPDATE refresh_operations.operations
    SET status = ${status}, completed_at = clock_timestamp(), last_error = ${failure}
    WHERE id = ${id}
  `

  return id
}

describe('countActive', () => {
  test('counts awaiting, pending and leased operations of the kind, class and payload', async () => {
    const countRecentlyViewed = () =>
      countActive(database, {
        kind: 'interactive-player-refresh',
        workClass: 'primary-monitoring',
        payloadEquals: { cohort: 'recently-viewed' },
      })

    const before = await countRecentlyViewed()

    await insertRefresh({ brawlhallaId: 1_001, workClass: 'primary-monitoring', status: 'pending' })
    await insertRefresh({ brawlhallaId: 1_002, workClass: 'primary-monitoring', status: 'succeeded' })
    await insertRefresh({ brawlhallaId: 1_003, status: 'pending' })

    expect(await countRecentlyViewed()).toBe(before + 1)
  })

  test('ignores operations whose payload does not match', async () => {
    const counted = await countActive(database, {
      kind: 'interactive-player-refresh',
      workClass: 'primary-monitoring',
      payloadEquals: { cohort: 'no-such-cohort' },
    })

    expect(counted).toBe(0)
  })
})

describe('readAttemptHistory', () => {
  const brawlhallaIds = { repeat: 2_001, once: 2_002, old: 2_003, otherSource: 2_004, rejected: 2_005 }

  const readDemand = () =>
    readAttemptHistory(database, {
      kind: 'interactive-player-refresh',
      groupByPayloadField: 'brawlhallaId',
      windowDays: 30,
      provenanceSources: ['interactive-api', 'discord'],
      workClass: 'interactive',
      excludedErrorCodes: ['actor_rate_limited', 'admission_reservation_expired'],
    })

  function historyFor(rows: Awaited<ReturnType<typeof readDemand>>, brawlhallaId: number) {
    return rows.find((row) => row.payloadValue === String(brawlhallaId))
  }

  test('groups attempts by the payload field and counts distinct days', async () => {
    await insertRefresh({ brawlhallaId: brawlhallaIds.repeat, ageDays: 1 })
    await insertRefresh({ brawlhallaId: brawlhallaIds.repeat, ageDays: 1 })
    await insertRefresh({ brawlhallaId: brawlhallaIds.repeat, ageDays: 3, source: 'discord' })
    await insertRefresh({ brawlhallaId: brawlhallaIds.once, ageDays: 2 })

    const rows = await readDemand()

    expect(historyFor(rows, brawlhallaIds.repeat)?.createdDays).toBe(2)
    expect(historyFor(rows, brawlhallaIds.once)?.createdDays).toBe(1)
  })

  test('leaves out attempts outside the window, source or class, and excluded error codes', async () => {
    await insertRefresh({ brawlhallaId: brawlhallaIds.old, ageDays: 40 })
    await insertRefresh({ brawlhallaId: brawlhallaIds.otherSource, ageDays: 1, source: 'desktop-api' })
    await insertRefresh({ brawlhallaId: brawlhallaIds.otherSource, ageDays: 1, workClass: 'primary-monitoring' })

    await insertRefresh({
      brawlhallaId: brawlhallaIds.rejected,
      ageDays: 1,
      status: 'dead_letter',
      lastErrorCode: 'actor_rate_limited',
    })

    const rows = await readDemand()

    expect(historyFor(rows, brawlhallaIds.old)).toBeUndefined()
    expect(historyFor(rows, brawlhallaIds.otherSource)).toBeUndefined()
    expect(historyFor(rows, brawlhallaIds.rejected)).toBeUndefined()
  })

  test('reports the latest attempt and the latest dead letter, for any work class when none is given', async () => {
    const source = `planner-${randomUUID()}`

    await insertRefresh({
      brawlhallaId: 2_010,
      workClass: 'primary-monitoring',
      source,
      ageDays: 5,
      status: 'dead_letter',
    })

    await insertRefresh({ brawlhallaId: 2_010, workClass: 'primary-monitoring', source, ageDays: 1 })
    await insertRefresh({ brawlhallaId: 2_011, workClass: 'primary-monitoring', source, ageDays: 1 })

    const rows = await readAttemptHistory(database, {
      kind: 'interactive-player-refresh',
      groupByPayloadField: 'brawlhallaId',
      windowDays: 30,
      provenanceSources: [source],
    })

    const failing = historyFor(rows, 2_010)
    const healthy = historyFor(rows, 2_011)

    if (!failing?.lastDeadLetteredAt) throw new Error('expected a dead-lettered attempt in the history')

    expect(failing.lastCreatedAt).toBeInstanceOf(Date)
    expect(failing.lastDeadLetteredAt).toBeInstanceOf(Date)
    expect(failing.lastCreatedAt.getTime()).toBeGreaterThan(failing.lastDeadLetteredAt.getTime())
    expect(healthy?.lastDeadLetteredAt).toBeNull()
  })
})
