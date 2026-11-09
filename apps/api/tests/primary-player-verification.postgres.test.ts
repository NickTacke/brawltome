import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { accountsModule, primaryPlayerVerificationContract } from '@brawltome/accounts'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  acceptOperation,
  assertValidJobInput,
  type JobDefinition,
  proofContract,
  queueModule,
  type WorkClass,
} from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { createTelemetry } from '@brawltome/telemetry'
import {
  createWorkerJobs,
  type WorkerAccountsDependencies,
  type WorkerDiscoveryDependencies,
} from '../src/worker/job-list'
import {
  createTestDeadLetters,
  createTestQueue,
  idleLeaderboardDependencies,
  idlePlayerDependencies,
  idleStatisticsDependencies,
} from './fixtures/queue'

let database: TestDatabase
let queue: ReturnType<typeof createTestQueue>

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'primary_player_verification',
    modules: [queueModule, accountsModule],
  })

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
    primaryMonitoring: { readSnapshot: async () => ({ observedAt: new Date(0), targets: [] }) },
  }

  const jobs = createWorkerJobs({
    ranking: { expireGenerations: async () => ({ outcome: 'lease-lost' }) },
    leaderboards: idleLeaderboardDependencies,
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
    player: idlePlayerDependencies,
    statistics: idleStatisticsDependencies,
  })

  return (kind: string): JobDefinition<unknown> => {
    const job = jobs.find((candidate) => candidate.kind === kind)

    if (!job) throw new Error(`job list has no job for ${kind}`)

    return job
  }
}

function contractFor(kind: 'proof' | 'primary-player-verification') {
  return kind === 'proof' ? proofContract : primaryPlayerVerificationContract
}

function acceptAttempt(kind: 'proof' | 'primary-player-verification', attemptId: string, maxAttempts = 3) {
  return acceptOperation(database, {
    job: contractFor(kind),
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

    const replayed = await createTestDeadLetters(database).replayDeadLetter({
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

    const replayed = await createTestDeadLetters(database).replayDeadLetter({
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

  test('a proof row and a new-kind row for one attempt write the account once', async () => {
    const attemptId = randomUUID()
    const operationKey = `primary-player:${attemptId}`
    const resolved = new Set<string>()
    let accountWrites = 0

    // like the accounts module, which leaves an attempt that is no longer pending alone
    const jobFor = createVerificationJobs(async (attempt) => {
      if (resolved.has(attempt)) return

      resolved.add(attempt)
      accountWrites += 1
    })

    const accept = (kind: 'proof' | 'primary-player-verification') =>
      queue.accept({
        job: contractFor(kind),
        dedupeKey: operationKey,
        operationKey,
        workClass: 'interactive',
        payload: { value: attemptId },
        provenance: { source: 'steam-openid', requestedBy: 'integration-test' },
        maxAttempts: 3,
      })

    // a deploy can leave the old row queued while the new route accepts the same attempt again
    const proofRow = await accept('proof')
    const newKindRow = await accept('primary-player-verification')

    expect(newKindRow.outcome).toBe('accepted')

    expect(await runJobOnce(queue, jobFor('proof'))).toBe('succeeded')
    expect(await runJobOnce(queue, jobFor('primary-player-verification'))).toBe('dead_letter')

    const first = await queue.inspect(proofRow.operationId)
    const second = await queue.inspect(newKindRow.operationId)

    expect(first.operation).toMatchObject({ kind: 'proof', status: 'succeeded' })
    expect(first.effects).toHaveLength(1)

    expect(second.operation).toMatchObject({
      kind: 'primary-player-verification',
      status: 'dead_letter',
      last_error: { code: 'effect_conflict' },
    })

    expect(second.effects).toHaveLength(0)
    expect(accountWrites).toBe(1)
  })

  test('the kind runs only on the interactive work class with a string value', () => {
    const check = (workClass: WorkClass, payload: Record<string, unknown>) =>
      assertValidJobInput(primaryPlayerVerificationContract, workClass, payload)

    expect(() => check('interactive', { value: 'attempt' })).not.toThrow()
    expect(() => check('maintenance', { value: 'attempt' })).toThrow('work class maintenance')
    expect(() => check('interactive', { value: 42 })).toThrow('proof value must be a string')
    expect(() => check('interactive', {})).toThrow('proof value must be a string')
  })
})
