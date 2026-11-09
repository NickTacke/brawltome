import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { operationMatches, queueModule, readEffectLineage } from '@brawltome/queue'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_lineage', modules: [queueModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

async function insertProofOperation(input: {
  id: string
  effectOperationId: string
  status: string
  operationKey: string
  completedAt?: Date
}): Promise<void> {
  await database.sql`
    INSERT INTO refresh_operations.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
       status, attempt_count, max_attempts, completed_at, replayed_from_operation_id)
    VALUES (${input.id}, ${input.effectOperationId}, 'proof', ${`dedupe:${input.id}`}, ${input.operationKey},
            'maintenance', ${database.sql.json({ value: 'x' })},
            ${database.sql.json({ source: 'lineage-test', requestedBy: 'test' })},
            ${input.status}, 0, 3, ${input.completedAt ?? null},
            ${input.id === input.effectOperationId ? null : input.effectOperationId})
  `
}

describe('readEffectLineage', () => {
  test('an empty input reads nothing', async () => {
    expect(await readEffectLineage(database.sql, [])).toEqual(new Map())
  })

  test('adds up the original and its replays, and leaves out an effect with no operations', async () => {
    const finishedEffect = randomUUID()
    const activeEffect = randomUUID()
    const missingEffect = randomUUID()
    const lastFinishedAt = new Date('2026-09-02T00:00:00.000Z')

    await insertProofOperation({
      id: finishedEffect,
      effectOperationId: finishedEffect,
      status: 'dead_letter',
      operationKey: 'finished-original',
      completedAt: new Date('2026-09-01T00:00:00.000Z'),
    })

    await insertProofOperation({
      id: randomUUID(),
      effectOperationId: finishedEffect,
      status: 'succeeded',
      operationKey: 'finished-replay',
      completedAt: lastFinishedAt,
    })

    await insertProofOperation({
      id: activeEffect,
      effectOperationId: activeEffect,
      status: 'dead_letter',
      operationKey: 'active-original',
      completedAt: new Date('2026-09-01T00:00:00.000Z'),
    })

    await insertProofOperation({
      id: randomUUID(),
      effectOperationId: activeEffect,
      status: 'pending',
      operationKey: 'active-replay',
    })

    const lineage = await readEffectLineage(database.sql, [finishedEffect, activeEffect, missingEffect])

    expect(lineage.get(finishedEffect)).toEqual({ hasUnfinished: false, hasFinished: true, lastFinishedAt })

    expect(lineage.get(activeEffect)).toMatchObject({ hasUnfinished: true, hasFinished: true })

    expect(lineage.has(missingEffect)).toBe(false)
  })
})

describe('operationMatches', () => {
  test('is true only when the identity of the operation matches', async () => {
    const id = randomUUID()

    await insertProofOperation({ id, effectOperationId: id, status: 'pending', operationKey: `key:${id}` })

    const identity = { operationId: id, effectOperationId: id, operationKey: `key:${id}`, kind: 'proof' }

    expect(await operationMatches(database.sql, identity)).toBe(true)

    expect(await operationMatches(database.sql, { ...identity, operationKey: 'other' })).toBe(false)
    expect(await operationMatches(database.sql, { ...identity, kind: 'other' })).toBe(false)
    expect(await operationMatches(database.sql, { ...identity, effectOperationId: randomUUID() })).toBe(false)
    expect(await operationMatches(database.sql, { ...identity, operationId: randomUUID() })).toBe(false)
  })
})
