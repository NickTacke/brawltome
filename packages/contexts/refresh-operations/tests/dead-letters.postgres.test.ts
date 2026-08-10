import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import type { OperationLease } from '@brawltome/refresh-operations'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_dead_letters_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

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
  if (!baseUrl) throw new Error('DATABASE_URL is required for dead-letter integration tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of refreshOperationsMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
})

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function createDeadLetter(value = 'sensitive-payload') {
  const operations = createPostgresRefreshOperations(connectionString)
  const accepted = await operations.accept({
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

function operatorEnv(rawToken: string) {
  return {
    DEAD_LETTER_DATABASE_URL: connectionString,
    DEAD_LETTER_OPERATOR_TOKEN: rawToken,
    DEAD_LETTER_OPERATOR_TOKENS: JSON.stringify([
      {
        actorId: 'operator:integration',
        tokenSha256: createHash('sha256').update(rawToken).digest('hex'),
      },
    ]),
  }
}

async function runCli(args: string[], env: Record<string, string>) {
  const process = Bun.spawn(['bun', 'packages/contexts/refresh-operations/cli.ts', ...args], {
    cwd: new URL('../../../..', import.meta.url).pathname,
    env: { ...globalThis.process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

describe('dead-letter operations', () => {
  test('lists redacted records and inspects full immutable evidence', async () => {
    const { operations, operationId } = await createDeadLetter()
    const second = await createDeadLetter('second-sensitive-payload')

    const firstPage = await operations.listDeadLetters({ limit: 1 })
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await operations.listDeadLetters({ limit: 1, cursor: firstPage.nextCursor as string })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0].operationId).not.toBe(firstPage.items[0].operationId)

    const page = await operations.listDeadLetters({ limit: 10 })
    const listed = page.items.find((item) => item.operationId === operationId)
    expect(listed).toMatchObject({
      operationId,
      kind: 'proof',
      workClass: 'maintenance',
      disposition: null,
      attemptCount: 1,
    })
    expect(listed).not.toHaveProperty('payload')

    const inspected = await operations.inspectDeadLetter(operationId)
    expect(inspected).toMatchObject({
      operation: {
        operationId,
        payload: { value: 'sensitive-payload' },
        provenance: { source: 'integration-test', requestedBy: 'issue-193' },
      },
      attempts: [{ attemptNumber: 1, outcome: 'dead_letter' }],
      auditActions: [],
    })
    await second.operations.close()
    await operations.close()
  })

  test('creates one linked immediate replay with fresh attempts under concurrent replay and discard', async () => {
    const { operations, operationId, lease: originalLease } = await createDeadLetter('replay-me')
    const actors = Array.from({ length: 20 }, () => createPostgresRefreshOperations(connectionString))
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

    const inspected = await operations.inspectDeadLetter(operationId)
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

    await Promise.all(actors.map((actor) => actor.close()))
    await operations.close()
  })

  test('replay preserves scheduled provenance and stable interactive section effects', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const firstDueAt = new Date(Date.now() - 1_000).toISOString()
    const schedule = await operations.createSchedule({
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
    const replayed = await operations.replayDeadLetter({
      operationId: scheduledLease.operationId,
      actorId: 'operator:scheduler',
      reason: 'repair scheduled collection',
    })
    expect(replayed.outcome).toBe('replayed')
    const replayInspection = await operations.inspectDeadLetter(scheduledLease.operationId)
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
      kind: 'proof',
      payload: scheduledLease.payload,
      scheduleWindowAt: scheduledLease.scheduleWindowAt,
      attemptNumber: 1,
    })
    expect(scheduledReplay.leaseToken).toBeGreaterThan(scheduledLease.leaseToken)
    await operations.complete(scheduledReplay)

    const reserved = await operations.reserveInteractivePlayerRefresh({
      dedupeKey: `interactive-dead-letter:${randomUUID()}`,
      operationKey: `interactive-effect:${randomUUID()}`,
      brawlhallaId: 42,
      staleSections: ['ranked', 'stats'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome !== 'reserved') throw new Error('Expected reservation')
    await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
    const original = requireLease(
      await operations.claim('interactive-original', 10_000, admission, 'interactive-player-refresh'),
    )
    if (original.kind !== 'interactive-player-refresh') throw new Error('Expected interactive operation')
    await operations.commitInteractiveSection(original, 'ranked')
    await operations.fail(original, { code: 'stats_failed', message: 'stats failed', retryable: false }, 0)
    const interactiveReplay = await operations.replayDeadLetter({
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
    expect(await operations.beginInteractiveSection(successor, 'ranked')).toBe('already-applied')
    expect(await operations.beginInteractiveSection(successor, 'stats')).toBe('execute')
    await operations.close()
  })

  test('preserves clan and leaderboard kinds, payloads, and effect identity on replay', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const leaderboard = await operations.accept({
      kind: 'leaderboard-1v1',
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
    const leaderboardReplay = await operations.replayDeadLetter({
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

    const clan = await operations.reserveInteractiveClanRefresh({
      dedupeKey: `clan-dead-letter:${randomUUID()}`,
      operationKey: `clan-effect:${randomUUID()}`,
      clanId: 73,
      staleSections: ['profile', 'roster'],
      provenance: { source: 'integration-test', requestedBy: 'issue-198' },
      reservationTtlSeconds: 30,
    })
    if (clan.outcome !== 'reserved') throw new Error('Expected clan reservation')
    await operations.activateInteractiveRefresh(clan.operationId, clan.reservationToken)
    const clanLease = requireLease(await operations.claim('clan-original', 10_000, admission, 'clan-refresh'))
    await operations.fail(clanLease, { code: 'clan_repairable', message: 'clan repairable', retryable: false }, 0)
    const clanReplay = await operations.replayDeadLetter({
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
    await operations.close()
  })

  test('makes audit actions append-only in PostgreSQL', async () => {
    const { operations, operationId } = await createDeadLetter()
    await operations.discardDeadLetter({
      operationId,
      actorId: 'operator:audit',
      reason: 'invalid operation confirmed',
    })
    for (const statement of [
      "UPDATE refresh_operations.dead_letter_actions SET reason = 'changed'",
      'DELETE FROM refresh_operations.dead_letter_actions',
      'TRUNCATE refresh_operations.dead_letter_actions',
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
    await operations.close()
  })

  test('authenticates the JSON CLI before PostgreSQL and never exposes token material', async () => {
    const rawToken = `raw-secret-${randomUUID()}`
    const missingAuth = await runCli(['list'], {
      DEAD_LETTER_DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/invalid',
      DEAD_LETTER_OPERATOR_TOKENS: operatorEnv(rawToken).DEAD_LETTER_OPERATOR_TOKENS,
    })
    expect(missingAuth.exitCode).toBe(1)
    expect(JSON.parse(missingAuth.stderr)).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
    expect(`${missingAuth.stdout}${missingAuth.stderr}`).not.toContain(rawToken)
    expect(`${missingAuth.stdout}${missingAuth.stderr}`).not.toContain('ECONNREFUSED')

    const { operations, operationId } = await createDeadLetter('cli-sensitive-payload')
    await operations.close()
    const listed = await runCli(['list', '--limit', '10'], operatorEnv(rawToken))
    expect(listed.exitCode).toBe(0)
    expect(listed.stderr).toBe('')
    expect(listed.stdout).not.toContain('cli-sensitive-payload')
    expect(listed.stdout).not.toContain(rawToken)
    expect(JSON.parse(listed.stdout)).toMatchObject({ ok: true, data: { items: expect.any(Array) } })

    const inspected = await runCli(['inspect', operationId], operatorEnv(rawToken))
    if (inspected.exitCode !== 0) throw new Error(`CLI inspect failed: ${inspected.stderr}`)
    expect(inspected.exitCode).toBe(0)
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      ok: true,
      data: { operation: { operationId, payload: { value: 'cli-sensitive-payload' } } },
    })

    const replayed = await runCli(
      ['replay', operationId, '--reason', 'upstream dependency repaired'],
      operatorEnv(rawToken),
    )
    expect(replayed.exitCode).toBe(0)
    expect(JSON.parse(replayed.stdout)).toMatchObject({
      ok: true,
      data: { outcome: 'replayed', disposition: 'replayed', replayOperationId: expect.any(String) },
    })
    const replayAudit = await runCli(['inspect', operationId], operatorEnv(rawToken))
    expect(JSON.parse(replayAudit.stdout)).toMatchObject({
      ok: true,
      data: { auditActions: [{ actorId: 'operator:integration', reason: 'upstream dependency repaired' }] },
    })

    const discardedTarget = await createDeadLetter('discard-through-cli')
    await discardedTarget.operations.close()
    const discarded = await runCli(
      ['discard', discardedTarget.operationId, '--reason', 'invalid source request confirmed'],
      operatorEnv(rawToken),
    )
    expect(discarded.exitCode).toBe(0)
    expect(JSON.parse(discarded.stdout)).toMatchObject({
      ok: true,
      data: { outcome: 'discarded', disposition: 'discarded', replayOperationId: null },
    })

    const blankReason = await runCli(['replay', operationId, '--reason', '   '], operatorEnv(rawToken))
    expect(blankReason.exitCode).toBe(1)
    expect(JSON.parse(blankReason.stderr)).toMatchObject({ ok: false, error: { code: 'invalid_reason' } })
    const longReason = await runCli(['discard', operationId, '--reason', 'x'.repeat(501)], operatorEnv(rawToken))
    expect(longReason.exitCode).toBe(1)
    expect(JSON.parse(longReason.stderr)).toMatchObject({ ok: false, error: { code: 'invalid_reason' } })

    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    for (const output of [missingAuth, listed, inspected, replayed, replayAudit, discarded, blankReason, longReason]) {
      expect(`${output.stdout}${output.stderr}`).not.toContain(rawToken)
      expect(`${output.stdout}${output.stderr}`).not.toContain(tokenHash)
    }
    const control = postgres(connectionString, { max: 1 })
    try {
      for (const secret of [rawToken, tokenHash]) {
        const [stored] = await control<{ found: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM refresh_operations.operations
            WHERE payload::text LIKE ${`%${secret}%`} OR provenance::text LIKE ${`%${secret}%`}
            UNION ALL
            SELECT 1 FROM refresh_operations.dead_letter_actions
            WHERE actor_id LIKE ${`%${secret}%`} OR reason LIKE ${`%${secret}%`}
          ) AS found
        `
        expect(stored.found).toBe(false)
      }
    } finally {
      await control.end()
    }
  }, 15_000)
})
