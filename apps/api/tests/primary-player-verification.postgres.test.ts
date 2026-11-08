import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { acceptOperation, type JobDefinition, refreshOperationsModule } from '@brawltome/refresh-operations'
import { runJobOnce } from '@brawltome/refresh-operations/testing'
import { createTelemetry } from '@brawltome/telemetry'
import {
  createWorkerJobs,
  type WorkerAccountsDependencies,
  type WorkerDiscoveryDependencies,
} from '../src/worker/job-list'
import { createTestQueue } from './fixtures/queue'

let database: TestDatabase
let queue: ReturnType<typeof createTestQueue>

beforeAll(async () => {
  database = await createTestDatabase({ label: 'primary_player_verification', modules: [refreshOperationsModule] })
  queue = createTestQueue({ database })
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

type Verify = (attemptId: string) => Promise<void>

// the worker's job list, with the Steam verification replaced by the given function
function createVerificationJobs(verify: Verify) {
  const accounts: WorkerAccountsDependencies = {
    accounts: {
      resolvePrimaryPlayerVerification: async (attemptId) => {
        await verify(attemptId)

        return {} as never
      },
    },
    createEvidenceResolver: () => ({ resolve: async () => null }),
  }

  const jobs = createWorkerJobs({
    ranking: { expireGenerations: async () => ({ outcome: 'lease-lost' }) },
    isRankingRetentionEnabled: true,
    telemetry: createTelemetry({ service: 'worker', drainIntervalMs: 0 }),
    discovery: {
      work: {} as WorkerDiscoveryDependencies['work'],
      checks: { projectionEffectState: async () => 'none', reconciliationEffectApplied: async () => false },
      playerSource: {} as WorkerDiscoveryDependencies['playerSource'],
      clanSource: {} as WorkerDiscoveryDependencies['clanSource'],
      leaseActive: async () => true,
    },
    clan: { clans: {} as never, createBrawlhallaClient: () => ({}) as never },
    accounts,
  })

  return (kind: string): JobDefinition<unknown> => {
    const job = jobs.find((candidate) => candidate.kind === kind)

    if (!job) throw new Error(`job list has no job for ${kind}`)

    return job
  }
}

function acceptAttempt(kind: 'proof' | 'primary-player-verification', attemptId: string, maxAttempts = 3) {
  return acceptOperation(database, {
    kind,
    dedupeKey: `primary-player:${attemptId}:${kind}`,
    operationKey: `primary-player:${attemptId}:${kind}`,
    workClass: 'interactive',
    payload: { value: attemptId },
    provenance: { source: 'steam-openid', requestedBy: 'integration-test' },
    maxAttempts,
  })
}

describe('primary player verification on the real queue', () => {
  test('replaying a dead-lettered proof row with a primary-player key runs the verification handler', async () => {
    const attemptId = randomUUID()
    const verified: string[] = []
    let shouldFail = true

    const job = createVerificationJobs(async (attempt) => {
      verified.push(attempt)

      if (shouldFail) throw new Error('steam lookup failed')
    })('proof')

    const accepted = await acceptAttempt('proof', attemptId, 1)

    expect(await runJobOnce(queue, job)).toBe('dead_letter')

    shouldFail = false

    const replayed = await queue.replayDeadLetter({
      operationId: accepted.operationId,
      actorId: 'operator:integration',
      reason: 'steam is back',
    })

    if (replayed.outcome !== 'replayed') throw new Error('expected a dead letter replay')

    expect(await runJobOnce(queue, job)).toBe('succeeded')

    const replay = await queue.inspect(replayed.replayOperationId as string)

    expect(replay.operation).toMatchObject({ kind: 'proof', status: 'succeeded' })
    // a replay keeps the original's effect identity, so its effect is stored under the original operation
    expect((await queue.inspect(accepted.operationId)).effects).toHaveLength(1)
    expect(verified).toEqual([attemptId, attemptId])
  })

  test('accepts the new kind, verifies and records one effect', async () => {
    const attemptId = randomUUID()
    const verified: string[] = []

    const job = createVerificationJobs(async (attempt) => {
      verified.push(attempt)
    })('primary-player-verification')

    const accepted = await acceptAttempt('primary-player-verification', attemptId)

    expect(await runJobOnce(queue, job)).toBe('succeeded')

    const state = await queue.inspect(accepted.operationId)

    expect(state.operation).toMatchObject({ kind: 'primary-player-verification', status: 'succeeded' })
    expect(state.effects).toHaveLength(1)
    expect(verified).toEqual([attemptId])
  })

  test('replays a dead-lettered new-kind row under its own kind', async () => {
    const attemptId = randomUUID()
    let shouldFail = true

    const job = createVerificationJobs(async () => {
      if (shouldFail) throw new Error('steam lookup failed')
    })('primary-player-verification')

    const accepted = await acceptAttempt('primary-player-verification', attemptId, 1)

    expect(await runJobOnce(queue, job)).toBe('dead_letter')

    shouldFail = false

    const replayed = await queue.replayDeadLetter({
      operationId: accepted.operationId,
      actorId: 'operator:integration',
      reason: 'steam is back',
    })

    if (replayed.outcome !== 'replayed') throw new Error('expected a dead letter replay')

    expect(await runJobOnce(queue, job)).toBe('succeeded')

    expect((await queue.inspect(replayed.replayOperationId as string)).operation).toMatchObject({
      kind: 'primary-player-verification',
      status: 'succeeded',
    })
  })

  test('the queue checks accept the new kind only on the interactive work class with a string value', async () => {
    const insertRow = async (workClass: string, payload: Record<string, unknown>) => {
      const operationId = randomUUID()

      await database.sql`
        INSERT INTO refresh_operations.operations
          (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
        VALUES (${operationId}, ${operationId}, 'primary-player-verification', ${operationId}, ${operationId},
                ${workClass}, ${database.sql.json(payload as never)}, ${database.sql.json({ source: 'test' })}, 3)
      `

      // nothing later in this file should claim it
      await database.sql`DELETE FROM refresh_operations.operations WHERE id = ${operationId}`
    }

    await expect(insertRow('interactive', { value: 'attempt' })).resolves.toBeUndefined()
    await expect(insertRow('maintenance', { value: 'attempt' })).rejects.toThrow('operations_payload_by_kind')
    await expect(insertRow('interactive', { value: 42 })).rejects.toThrow('operations_payload_by_kind')
    await expect(insertRow('interactive', {})).rejects.toThrow('operations_payload_by_kind')
  })

  test('both kind checks are validated once every migration has run', async () => {
    const constraints = await database.sql<{ conname: string; convalidated: boolean }[]>`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conrelid = 'refresh_operations.operations'::regclass
        AND conname IN ('operations_kind_check', 'operations_payload_by_kind')
    `

    expect(constraints.toSorted((a, b) => a.conname.localeCompare(b.conname))).toEqual([
      { conname: 'operations_kind_check', convalidated: true },
      { conname: 'operations_payload_by_kind', convalidated: true },
    ])
  })
})
