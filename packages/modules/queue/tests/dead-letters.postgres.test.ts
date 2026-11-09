import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  activateReserved,
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  type DeadLetterHooks,
  type DeadLetterOperations,
  type EffectDescriber,
  interactiveRefreshMaxAttempts,
  type OperationLease,
  proofContract,
  queueModule,
  type ReplayGuard,
  reconcileResourceSchedules,
  reserveForAdmission,
} from '@brawltome/queue'
import { createPassthroughJobContract } from '@brawltome/queue/testing'
import { readTestProofEffects, testProofEffects } from './test-proof-effects'
import { testWatermark } from './test-watermark'

let database: TestDatabase
let connectionString = ''
let deadLetters: DeadLetterOperations

// proof effects are real here; the other kinds' modules aren't loaded in a queue-only database
const queueOnlyJobs = [
  proofContract,
  ...[
    'clan-refresh',
    'interactive-player-refresh',
    'leaderboard-1v1',
    'player-discovery-projection',
    'ranked-player-pulse',
  ].map(createPassthroughJobContract),
]

const noHooks: DeadLetterHooks = { replayGuards: new Map(), describeEffects: new Map() }

const admission = {
  totalConcurrency: 4,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 5,
    leaderboard: 4,
    'global-statistics': 3,
    projection: 2,
    maintenance: 1,
  },
} as const

function requireLease(lease: OperationLease | null): OperationLease {
  if (!lease) throw new Error('Expected an operation lease')

  return lease
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_dead_letters', modules: [queueModule] })
  connectionString = database.connectionString
  deadLetters = createPostgresDeadLetterOperations(database, noHooks)
})

afterAll(async () => {
  await database?.drop()
})

async function createDeadLetter(value = 'sensitive-payload') {
  const operations = createPostgresRefreshOperations(
    { database },
    { jobs: queueOnlyJobs, proofEffects: testProofEffects },
  )

  const accepted = await operations.accept({
    job: proofContract,
    dedupeKey: `dead-letter:${randomUUID()}`,
    operationKey: `effect:${randomUUID()}`,
    workClass: 'maintenance',
    payload: { value },
    provenance: { source: 'integration-test', requestedBy: 'issue-193' },
    maxAttempts: 1,
  })

  let lease: OperationLease

  for (;;) {
    const candidate = requireLease(await operations.claim('dead-letter-worker', 10_000, admission))

    if (candidate.operationId === accepted.operationId) {
      lease = candidate
      break
    }

    if (candidate.kind === 'proof') await operations.commitProofEffect(candidate)

    await operations.complete(candidate)
  }

  await operations.fail(
    lease,
    { code: 'terminal_test_failure', message: 'Deliberate terminal failure', retryable: false },
    0,
  )

  return { operations, operationId: accepted.operationId, lease }
}

describe('dead-letter operations', () => {
  test('lists redacted records and inspects full immutable evidence', async () => {
    const { operationId } = await createDeadLetter()

    await createDeadLetter('second-sensitive-payload')

    const firstPage = await deadLetters.listDeadLetters({ limit: 1 })

    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await deadLetters.listDeadLetters({ limit: 1, cursor: firstPage.nextCursor as string })

    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0].operationId).not.toBe(firstPage.items[0].operationId)

    const page = await deadLetters.listDeadLetters({ limit: 10 })
    const listed = page.items.find((item) => item.operationId === operationId)

    expect(listed).toMatchObject({
      operationId,
      kind: 'proof',
      workClass: 'maintenance',
      disposition: null,
      attemptCount: 1,
    })

    expect(listed).not.toHaveProperty('payload')

    const inspected = await deadLetters.inspectDeadLetter(operationId)

    expect(inspected).toMatchObject({
      operation: {
        operationId,
        payload: { value: 'sensitive-payload' },
        provenance: { source: 'integration-test', requestedBy: 'issue-193' },
      },
      attempts: [{ attemptNumber: 1, outcome: 'dead_letter' }],
      auditActions: [],
    })
  })

  test('creates one linked immediate replay with fresh attempts under concurrent replay and discard', async () => {
    const { operations, operationId, lease: originalLease } = await createDeadLetter('replay-me')
    const actors = Array.from({ length: 20 }, () => createPostgresDeadLetterOperations(database, noHooks))

    const results = await Promise.all(
      actors.map((actor, index) =>
        index % 2 === 0
          ? actor.replayDeadLetter({ operationId, actorId: `operator:${index}`, reason: 'retry after upstream repair' })
          : actor.discardDeadLetter({ operationId, actorId: `operator:${index}`, reason: 'confirmed invalid input' }),
      ),
    )

    const terminal = results.filter((result) => result.outcome === 'replayed' || result.outcome === 'discarded')

    expect(terminal).toHaveLength(1)
    expect(results.every((result) => result.disposition === terminal[0].disposition)).toBe(true)

    const inspected = await deadLetters.inspectDeadLetter(operationId)

    expect(inspected?.auditActions).toHaveLength(1)
    const action = inspected?.auditActions[0]

    expect(action).toMatchObject({ targetOperationId: operationId, disposition: terminal[0].disposition })

    if (terminal[0].outcome === 'replayed') {
      const replay = requireLease(await operations.claim('replay-worker', 10_000, admission))

      expect(replay).toMatchObject({
        operationId: terminal[0].replayOperationId,
        effectOperationId: originalLease.effectOperationId,
        operationKey: originalLease.operationKey,
        kind: originalLease.kind,
        workClass: originalLease.workClass,
        payload: originalLease.payload,
        provenance: originalLease.provenance,
        attemptNumber: 1,
      })

      expect(replay.maxAttempts).toBe(originalLease.maxAttempts)

      expect((await operations.inspect(replay.operationId)).operation).toMatchObject({
        replayed_from_operation_id: operationId,
        attempt_count: 1,
      })

      if (replay.kind !== 'proof') throw new Error('Expected proof replay')

      expect(await operations.commitProofEffect(replay)).toBe('applied')
      expect(await operations.complete(replay)).toBe('transitioned')
    }
  })

  test('replay preserves scheduled provenance and stable interactive section effects', async () => {
    const operations = createPostgresRefreshOperations(
      { database },
      { jobs: queueOnlyJobs, proofEffects: testProofEffects },
    )

    const firstDueAt = new Date(Date.now() - 1_000).toISOString()

    const schedule = await operations.createSchedule({
      job: proofContract,
      scheduleKey: `dead-letter-schedule:${randomUUID()}`,
      operationKeyPrefix: `scheduled-effect:${randomUUID()}`,
      workClass: 'projection',
      intervalMs: 3_600_000,
      firstDueAt,
      payload: { value: 'scheduled' },
      provenance: { source: 'scheduler', requestedBy: 'issue-192' },
      maxAttempts: 1,
    })

    await operations.materializeDueSchedules()
    const scheduledLease = requireLease(await operations.claim('scheduled-worker', 10_000, admission))

    await operations.fail(
      scheduledLease,
      { code: 'scheduled_failure', message: 'scheduled failure', retryable: false },
      0,
    )

    const replayed = await deadLetters.replayDeadLetter({
      operationId: scheduledLease.operationId,
      actorId: 'operator:scheduler',
      reason: 'repair scheduled collection',
    })

    expect(replayed.outcome).toBe('replayed')
    const replayInspection = await deadLetters.inspectDeadLetter(scheduledLease.operationId)

    expect(replayInspection?.schedule).toMatchObject({
      scheduleId: schedule.scheduleId,
      firstWindowNumber: 0,
      missedWindowCount: 0,
    })

    if (replayed.outcome !== 'replayed') throw new Error('Expected scheduled replay')

    expect((await operations.inspect(replayed.replayOperationId as string)).operation).toMatchObject({
      replayed_from_operation_id: scheduledLease.operationId,
      origin_schedule_occurrence_id: expect.any(String),
    })

    const scheduledReplay = requireLease(await operations.claim('scheduled-replay', 10_000, admission, 'proof'))

    expect(scheduledReplay).toMatchObject({
      operationId: replayed.replayOperationId,
      effectOperationId: scheduledLease.effectOperationId,
      effectCreatedAt: scheduledLease.effectCreatedAt,
      kind: 'proof',
      payload: scheduledLease.payload,
      scheduleWindowAt: scheduledLease.scheduleWindowAt,
      attemptNumber: 1,
    })

    expect(scheduledReplay.leaseToken).toBeGreaterThan(scheduledLease.leaseToken)
    await operations.complete(scheduledReplay)

    const reserved = await reserveForAdmission(database, {
      job: createPassthroughJobContract('interactive-player-refresh'),
      dedupeKey: `interactive-dead-letter:${randomUUID()}`,
      operationKey: `interactive-effect:${randomUUID()}`,
      resourceKey: 'player:42',
      workClass: 'interactive',
      payload: { brawlhallaId: 42, staleSections: ['ranked', 'stats'] },
      provenance: { source: 'integration-test' },
      maxAttempts: interactiveRefreshMaxAttempts,
      reservationTtlSeconds: 30,
    })

    if (reserved.outcome !== 'reserved') throw new Error('Expected reservation')

    await activateReserved(database, {
      operationId: reserved.operationId,
      reservationToken: reserved.reservationToken,
      kinds: ['interactive-player-refresh'],
    })

    const original = requireLease(
      await operations.claim('interactive-original', 10_000, admission, 'interactive-player-refresh'),
    )

    if (original.kind !== 'interactive-player-refresh') throw new Error('Expected interactive operation')

    await operations.commitInteractiveSection(original, 'ranked')
    await operations.fail(original, { code: 'stats_failed', message: 'stats failed', retryable: false }, 0)

    const interactiveReplay = await deadLetters.replayDeadLetter({
      operationId: original.operationId,
      actorId: 'operator:interactive',
      reason: 'upstream recovered',
    })

    expect(interactiveReplay.outcome).toBe('replayed')

    const successor = requireLease(
      await operations.claim('interactive-replay', 10_000, admission, 'interactive-player-refresh'),
    )

    if (successor.kind !== 'interactive-player-refresh') throw new Error('Expected interactive replay')

    expect(successor.effectOperationId).toBe(original.effectOperationId)
    expect(successor.effectCreatedAt).toBe(original.effectCreatedAt)
    expect(await operations.beginInteractiveSection(successor, 'ranked')).toBe('already-applied')
    expect(await operations.beginInteractiveSection(successor, 'stats')).toBe('execute')
  })

  test('preserves clan, leaderboard, and projection kinds, payloads, and effect identity on replay', async () => {
    const operations = createPostgresRefreshOperations(
      { database },
      { jobs: queueOnlyJobs, proofEffects: testProofEffects },
    )

    const leaderboard = await operations.accept({
      job: createPassthroughJobContract('leaderboard-1v1'),
      dedupeKey: `leaderboard-dead-letter:${randomUUID()}`,
      operationKey: `leaderboard-effect:${randomUUID()}`,
      workClass: 'leaderboard',
      payload: { pageDepth: 2, intervalMs: 60_000 },
      provenance: { source: 'integration-test', requestedBy: 'issue-201' },
      maxAttempts: 1,
    })

    const leaderboardLease = requireLease(
      await operations.claim('leaderboard-original', 10_000, admission, 'leaderboard-1v1'),
    )

    expect(leaderboardLease.operationId).toBe(leaderboard.operationId)

    await operations.fail(
      leaderboardLease,
      { code: 'leaderboard_repairable', message: 'leaderboard repairable', retryable: false },
      0,
    )

    const leaderboardReplay = await deadLetters.replayDeadLetter({
      operationId: leaderboardLease.operationId,
      actorId: 'operator:leaderboard',
      reason: 'leaderboard source repaired',
    })

    if (leaderboardReplay.outcome !== 'replayed') throw new Error('Expected leaderboard replay')

    const leaderboardSuccessor = requireLease(
      await operations.claim('leaderboard-replay', 10_000, admission, 'leaderboard-1v1'),
    )

    expect(leaderboardSuccessor).toMatchObject({
      operationId: leaderboardReplay.replayOperationId,
      effectOperationId: leaderboardLease.effectOperationId,
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      payload: leaderboardLease.payload,
      provenance: leaderboardLease.provenance,
      attemptNumber: 1,
    })

    expect(leaderboardSuccessor.leaseToken).toBeGreaterThan(leaderboardLease.leaseToken)
    await operations.complete(leaderboardSuccessor)

    const clan = await reserveForAdmission(database, {
      job: createPassthroughJobContract('clan-refresh'),
      dedupeKey: `clan-dead-letter:${randomUUID()}`,
      operationKey: `clan-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { clanId: 73, staleSections: ['profile', 'roster'] },
      provenance: { source: 'integration-test', requestedBy: 'issue-198' },
      maxAttempts: interactiveRefreshMaxAttempts,
      reservationTtlSeconds: 30,
    })

    if (clan.outcome !== 'reserved') throw new Error('Expected clan reservation')

    await activateReserved(database, {
      operationId: clan.operationId,
      reservationToken: clan.reservationToken,
      kinds: ['clan-refresh'],
    })

    const clanLease = requireLease(await operations.claim('clan-original', 10_000, admission, 'clan-refresh'))

    await operations.fail(clanLease, { code: 'clan_repairable', message: 'clan repairable', retryable: false }, 0)

    const clanReplay = await deadLetters.replayDeadLetter({
      operationId: clanLease.operationId,
      actorId: 'operator:clan',
      reason: 'clan source repaired',
    })

    if (clanReplay.outcome !== 'replayed') throw new Error('Expected clan replay')

    const clanSuccessor = requireLease(await operations.claim('clan-replay', 10_000, admission, 'clan-refresh'))

    expect(clanSuccessor).toMatchObject({
      operationId: clanReplay.replayOperationId,
      effectOperationId: clanLease.effectOperationId,
      kind: 'clan-refresh',
      workClass: 'interactive',
      payload: clanLease.payload,
      provenance: clanLease.provenance,
      attemptNumber: 1,
    })

    expect(clanSuccessor.leaseToken).toBeGreaterThan(clanLease.leaseToken)
    await operations.complete(clanSuccessor)

    const projection = await operations.accept({
      job: createPassthroughJobContract('player-discovery-projection'),
      dedupeKey: `player-discovery-dead-letter:${randomUUID()}`,
      operationKey: `player-discovery-effect:${randomUUID()}`,
      workClass: 'projection',
      payload: { batchSize: 100 },
      provenance: { source: 'integration-test', requestedBy: 'issue-199' },
      maxAttempts: 1,
    })

    const projectionLease = requireLease(
      await operations.claim('player-discovery-original', 10_000, admission, 'player-discovery-projection'),
    )

    expect(projectionLease.operationId).toBe(projection.operationId)

    await operations.fail(
      projectionLease,
      { code: 'projection_repairable', message: 'projection repairable', retryable: false },
      0,
    )

    const projectionReplay = await deadLetters.replayDeadLetter({
      operationId: projectionLease.operationId,
      actorId: 'operator:player-discovery',
      reason: 'projection source repaired',
    })

    if (projectionReplay.outcome !== 'replayed') throw new Error('Expected player discovery replay')

    const projectionSuccessor = requireLease(
      await operations.claim('player-discovery-replay', 10_000, admission, 'player-discovery-projection'),
    )

    expect(projectionSuccessor).toMatchObject({
      operationId: projectionReplay.replayOperationId,
      effectOperationId: projectionLease.effectOperationId,
      kind: 'player-discovery-projection',
      workClass: 'projection',
      payload: projectionLease.payload,
      provenance: projectionLease.provenance,
      attemptNumber: 1,
    })

    expect(projectionSuccessor.leaseToken).toBeGreaterThan(projectionLease.leaseToken)
    await operations.complete(projectionSuccessor)

    await operations.accept({
      job: createPassthroughJobContract('ranked-player-pulse'),
      dedupeKey: `pulse-dead-letter:${randomUUID()}`,
      operationKey: `pulse-effect:${randomUUID()}`,
      workClass: 'primary-monitoring',
      payload: { brawlhallaId: 42 },
      provenance: { source: 'integration-test' },
      maxAttempts: 1,
    })

    const pulseLease = requireLease(await operations.claim('pulse-original', 10_000, admission, 'ranked-player-pulse'))

    await operations.fail(pulseLease, { code: 'pulse_repairable', message: 'pulse repairable', retryable: false }, 0)

    const pulseReplay = await deadLetters.replayDeadLetter({
      operationId: pulseLease.operationId,
      actorId: 'operator:pulse',
      reason: 'pulse source repaired',
    })

    if (pulseReplay.outcome !== 'replayed') throw new Error('Expected pulse replay')

    const pulseSuccessor = requireLease(
      await operations.claim('pulse-replay', 10_000, admission, 'ranked-player-pulse'),
    )

    expect(pulseSuccessor).toMatchObject({
      operationId: pulseReplay.replayOperationId,
      effectOperationId: pulseLease.effectOperationId,
      effectCreatedAt: pulseLease.effectCreatedAt,
      kind: 'ranked-player-pulse',
      workClass: 'primary-monitoring',
      payload: pulseLease.payload,
      attemptNumber: 1,
    })

    await operations.complete(pulseSuccessor)

    const monitoringTarget = {
      assignmentId: randomUUID(),
      brawlhallaId: 43,
      verifiedAt: new Date(Date.now() - 24 * 60 * 60 * 1_000 - 1_000),
    }

    await reconcileResourceSchedules(database, {
      provenanceSource: 'primary-player-monitoring',
      observedAt: new Date(),
      watermark: testWatermark,
      identityPayloadFields: ['assignmentId', 'brawlhallaId'],
      schedules: [
        {
          job: createPassthroughJobContract('interactive-player-refresh'),
          scheduleKey: `primary-player:${monitoringTarget.brawlhallaId}:${monitoringTarget.assignmentId}`,
          operationKeyPrefix: `primary-player:${monitoringTarget.brawlhallaId}`,
          resourceKey: `player:${monitoringTarget.brawlhallaId}`,
          workClass: 'primary-monitoring',
          intervalMs: 24 * 60 * 60 * 1_000,
          firstDueAt: new Date(monitoringTarget.verifiedAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
          payload: {
            assignmentId: monitoringTarget.assignmentId,
            brawlhallaId: monitoringTarget.brawlhallaId,
            staleSections: ['ranked', 'stats'],
          },
          provenance: { source: 'primary-player-monitoring', requestedBy: 'issue-208' },
          maxAttempts: 3,
        },
      ],
    })

    await operations.materializeDueSchedules()

    const monitoringLease = requireLease(
      await operations.claim('monitoring-original', 10_000, admission, 'interactive-player-refresh'),
    )

    await operations.fail(
      monitoringLease,
      { code: 'monitoring_repairable', message: 'monitoring repairable', retryable: false },
      0,
    )

    const monitoringReplay = await deadLetters.replayDeadLetter({
      operationId: monitoringLease.operationId,
      actorId: 'operator:monitoring',
      reason: 'monitoring source repaired',
    })

    if (monitoringReplay.outcome !== 'replayed') throw new Error('Expected monitoring replay')

    const monitoringSuccessor = requireLease(
      await operations.claim('monitoring-replay', 10_000, admission, 'interactive-player-refresh'),
    )

    expect(monitoringSuccessor).toMatchObject({
      operationId: monitoringReplay.replayOperationId,
      effectOperationId: monitoringLease.effectOperationId,
      effectCreatedAt: monitoringLease.effectCreatedAt,
      kind: 'interactive-player-refresh',
      workClass: 'primary-monitoring',
      payload: {
        assignmentId: monitoringTarget.assignmentId,
        brawlhallaId: monitoringTarget.brawlhallaId,
        staleSections: ['ranked', 'stats'],
      },
      provenance: { source: 'primary-player-monitoring', requestedBy: 'issue-208' },
      attemptNumber: 1,
    })

    if (monitoringSuccessor.kind !== 'interactive-player-refresh') throw new Error('Expected monitoring replay')

    expect(await operations.beginInteractiveSection(monitoringSuccessor, 'ranked')).toBe('execute')
    expect(await operations.beginInteractiveSection(monitoringSuccessor, 'stats')).toBe('execute')
    await operations.complete(monitoringSuccessor)
  })

  test('makes audit actions append-only in PostgreSQL', async () => {
    const { operationId } = await createDeadLetter()

    await deadLetters.discardDeadLetter({
      operationId,
      actorId: 'operator:audit',
      reason: 'invalid operation confirmed',
    })

    for (const statement of [
      "UPDATE queue.dead_letter_actions SET reason = 'changed'",
      'DELETE FROM queue.dead_letter_actions',
      'TRUNCATE queue.dead_letter_actions',
    ]) {
      const mutation = Bun.spawn(['psql', connectionString, '-v', 'ON_ERROR_STOP=1', '-c', statement], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const [exitCode, stderr] = await Promise.all([
        mutation.exited,
        new Response(mutation.stderr).text(),
        new Response(mutation.stdout).text(),
      ])

      expect(exitCode).not.toBe(0)
      expect(stderr).toContain('dead-letter audit actions are immutable')
    }
  })

  test('a kind with no describer keeps every field of the inspection, empty', async () => {
    const { operationId } = await createDeadLetter('no-describer')

    const inspected = await deadLetters.inspectDeadLetter(operationId)

    expect(Object.keys(inspected ?? {})).toEqual([
      'operation',
      'attempts',
      'proofEffects',
      'interactiveEffects',
      'leaderboardEffects',
      'statisticsEffects',
      'statisticsPublicationEffects',
      'schedule',
      'auditActions',
    ])

    expect(inspected).toMatchObject({
      proofEffects: [],
      interactiveEffects: [],
      leaderboardEffects: [],
      statisticsEffects: [],
      statisticsPublicationEffects: [],
    })
  })

  test('a describer fills in its own field and leaves the rest of the inspection in place', async () => {
    const { operations, operationId, lease } = await createDeadLetter('described')

    await database.sql`
      INSERT INTO queue.proof_effects (operation_key, operation_id, lease_token, effect_value)
      VALUES (${lease.operationKey}, ${lease.effectOperationId}, ${lease.leaseToken}, ${database.sql.json({ value: 'x' })})
    `

    const describing = createPostgresDeadLetterOperations(database, {
      replayGuards: new Map(),
      describeEffects: new Map<string, EffectDescriber>([
        [
          lease.kind,
          async (transaction, effectOperationId) => ({
            proofEffects: await readTestProofEffects(transaction, effectOperationId),
          }),
        ],
      ]),
    })

    const inspected = await describing.inspectDeadLetter(operationId)

    expect(inspected?.proofEffects).toEqual([
      { operationKey: lease.operationKey, effectValue: { value: 'x' }, createdAt: expect.any(String) },
    ])

    expect(inspected?.interactiveEffects).toEqual([])
    expect(Object.keys(inspected ?? {})[2]).toBe('proofEffects')
    expect(await operations.inspect(operationId)).toMatchObject({ operation: { status: 'dead_letter' } })
  })

  test('a replay guard that rejects stops the replay and the discard, inside their transaction', async () => {
    const { operationId } = await createDeadLetter('guarded')

    const guarded = createPostgresDeadLetterOperations(database, {
      replayGuards: new Map<string, ReplayGuard>([
        [
          'proof',
          async () => {
            throw new Error('held by a test guard')
          },
        ],
      ]),
      describeEffects: new Map(),
    })

    const input = { operationId, actorId: 'operator:guard', reason: 'guarded' }

    await expect(guarded.replayDeadLetter(input)).rejects.toThrow('held by a test guard')
    await expect(guarded.discardDeadLetter(input)).rejects.toThrow('held by a test guard')

    const inspected = await deadLetters.inspectDeadLetter(operationId)

    expect(inspected?.auditActions).toEqual([])
  })
})
