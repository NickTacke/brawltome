import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { acceptOperation, queueModule, reserveForAdmission, rewritePendingOperation } from '@brawltome/queue'
import { createPassthroughJobContract } from '@brawltome/queue/testing'

const refreshContract = createPassthroughJobContract('interactive-player-refresh')

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_rewrite', modules: [queueModule] })
})

afterAll(async () => {
  await database?.drop()
})

async function acceptPending(payload: Record<string, unknown>): Promise<string> {
  const key = randomUUID()

  const accepted = await acceptOperation(database, {
    job: refreshContract,
    dedupeKey: key,
    operationKey: key,
    workClass: 'primary-monitoring',
    payload,
    provenance: { source: 'integration-test' },
  })

  return accepted.operationId
}

async function readOperation(operationId: string) {
  const [row] = await database.sql<
    { work_class: string; payload: unknown; available_at: Date; attempt_count: number; updated_at: Date }[]
  >`
    SELECT work_class, payload, available_at, attempt_count, updated_at FROM queue.operations WHERE id = ${operationId}
  `

  return row
}

describe('rewritePendingOperation', () => {
  test('rewrites a pending operation still holding the payload the caller read, and keeps its place in line', async () => {
    const read = { brawlhallaId: 7, staleSections: ['ranked'] }
    const operationId = await acceptPending(read)
    const before = await readOperation(operationId)

    const isRewritten = await rewritePendingOperation(database, {
      job: refreshContract,
      operationId,
      expectedPayload: read,
      workClass: 'interactive',
      payload: { brawlhallaId: 7, staleSections: ['ranked', 'stats'] },
    })

    expect(isRewritten).toBe(true)

    expect(await readOperation(operationId)).toMatchObject({
      work_class: 'interactive',
      payload: { brawlhallaId: 7, staleSections: ['ranked', 'stats'] },
      available_at: before.available_at,
      attempt_count: before.attempt_count,
    })
  })

  test('refuses when someone rewrote the payload after the caller read it', async () => {
    const read = { brawlhallaId: 8, staleSections: ['ranked'] }
    const operationId = await acceptPending(read)

    await database.sql`
      UPDATE queue.operations SET payload = ${database.sql.json({ brawlhallaId: 8, staleSections: ['ranked', 'stats'] })}
      WHERE id = ${operationId}
    `

    const isRewritten = await rewritePendingOperation(database, {
      job: refreshContract,
      operationId,
      expectedPayload: read,
      workClass: 'interactive',
      payload: { brawlhallaId: 8, staleSections: ['ranked'] },
    })

    expect(isRewritten).toBe(false)
    expect((await readOperation(operationId)).payload).toEqual({ brawlhallaId: 8, staleSections: ['ranked', 'stats'] })
  })

  test('leaves a reservation awaiting admission to the visitor who made it', async () => {
    const key = randomUUID()
    const payload = { brawlhallaId: 9, staleSections: ['stats'] }

    const reserved = await reserveForAdmission(database, {
      job: refreshContract,
      dedupeKey: key,
      operationKey: key,
      workClass: 'interactive',
      payload,
      provenance: { source: 'integration-test' },
      maxAttempts: 4,
      reservationTtlSeconds: 30,
    })

    if (reserved.outcome !== 'reserved') throw new Error('expected a reservation')

    const isRewritten = await rewritePendingOperation(database, {
      job: refreshContract,
      operationId: reserved.operationId,
      expectedPayload: payload,
      workClass: 'interactive',
      payload: { brawlhallaId: 9, staleSections: ['ranked', 'stats'] },
    })

    expect(isRewritten).toBe(false)
    expect((await readOperation(reserved.operationId)).payload).toEqual(payload)
  })
})
