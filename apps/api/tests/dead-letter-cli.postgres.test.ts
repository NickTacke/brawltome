import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { accountsModule, proofEffectStore } from '@brawltome/accounts'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  type AdmissionConfig,
  createPostgresRefreshOperations,
  type OperationLease,
  refreshOperationsModule,
} from '@brawltome/refresh-operations'
import { createStatisticsReservations } from '@brawltome/statistics'
import postgres from 'postgres'

const repositoryRoot = resolve(import.meta.dir, '../../..')

let database: TestDatabase
let connectionString = ''

const admission: AdmissionConfig = {
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
}

function requireLease(lease: OperationLease | null): OperationLease {
  if (!lease) throw new Error('Expected an operation lease')

  return lease
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'dead_letter_cli', modules: [refreshOperationsModule, accountsModule] })
  connectionString = database.connectionString
})

afterAll(async () => {
  await database?.drop()
})

async function createDeadLetter(value = 'sensitive-payload') {
  const operations = createPostgresRefreshOperations({ database }, { effectStates: {}, proofEffects: proofEffectStore })

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

async function createCollectionDeadLetter() {
  const operations = createPostgresRefreshOperations({ database }, { effectStates: {}, proofEffects: proofEffectStore })
  const reservations = createStatisticsReservations(database)
  const cohortId = randomUUID()
  const operationKey = `statistics:${cohortId}:42:ranked`

  const reserved = await reservations.reserveStatisticsCollection({
    kind: 'statistics-ranked-collection',
    dedupeKey: operationKey,
    operationKey,
    workClass: 'global-statistics',
    payload: { cohortId, brawlhallaId: 42 },
    provenance: { source: 'statistics-cohort-reconciliation', requestedBy: 'issue-209' },
    maxAttempts: 1,
  })

  await reservations.activateStatisticsCollection(reserved.operationId)

  const lease = requireLease(
    await operations.claim('statistics-worker', 10_000, admission, 'statistics-ranked-collection'),
  )

  await operations.fail(lease, { code: 'source_failed', message: 'repairable', retryable: false }, 0)

  return lease
}

async function sealCollection(collectionOperationId: string) {
  const reservations = createStatisticsReservations(database)
  const operationKey = `statistics:${randomUUID()}:publication`

  const publication = await reservations.reserveStatisticsPublication({
    kind: 'statistics-publication',
    dedupeKey: operationKey,
    operationKey,
    workClass: 'global-statistics',
    payload: { generationId: randomUUID(), product: 'ranked' },
    provenance: { source: 'statistics-publication-validation', requestedBy: 'issue-210' },
  })

  await database.sql`
    INSERT INTO refresh_operations.statistics_collection_seals (collection_operation_id, publication_operation_id)
    VALUES (${collectionOperationId}, ${publication.operationId})
  `
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
  const process = Bun.spawn(['bun', 'apps/api/src/dead-letter-cli.ts', ...args], {
    cwd: repositoryRoot,
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

describe('dead-letter CLI', () => {
  test('runs every CLI command with only dedicated dead-letter privileges', async () => {
    const role = 'brawltome_dead_letter'
    const rolePassword = `operator-${randomUUID()}`
    const rawToken = `raw-secret-${randomUUID()}`
    const databaseUrl = new URL(connectionString)
    const secretRoot = mkdtempSync(join(tmpdir(), 'brawltome-dead-letter-role-'))

    writeFileSync(join(secretRoot, 'postgres_owner_password'), decodeURIComponent(databaseUrl.password), {
      mode: 0o400,
    })

    writeFileSync(join(secretRoot, 'postgres_dead_letter_password'), rolePassword, { mode: 0o400 })

    const configured = Bun.spawn(['sh', resolve(repositoryRoot, 'infra/app/postgres/configure-dead-letter-role.sh')], {
      env: {
        ...process.env,
        BRAWLTOME_SECRETS_ROOT: secretRoot,
        PGDATABASE: databaseUrl.pathname.slice(1),
        PGHOST: databaseUrl.hostname,
        PGPASSWORD: decodeURIComponent(databaseUrl.password),
        PGPORT: databaseUrl.port,
        PGUSER: decodeURIComponent(databaseUrl.username),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [configuredExitCode, configuredStderr] = await Promise.all([
      configured.exited,
      new Response(configured.stderr).text(),
    ])

    expect(configuredExitCode, configuredStderr).toBe(0)

    const operatorUrl = new URL(connectionString)

    operatorUrl.username = role
    operatorUrl.password = rolePassword
    const env = { ...operatorEnv(rawToken), DEAD_LETTER_DATABASE_URL: operatorUrl.toString() }
    const replayTarget = await createDeadLetter('restricted-replay')
    const discardTarget = await createDeadLetter('restricted-discard')

    try {
      expect((await runCli(['list'], env)).exitCode).toBe(0)
      expect((await runCli(['inspect', replayTarget.operationId], env)).exitCode).toBe(0)
      expect((await runCli(['replay', replayTarget.operationId, '--reason', 'source repaired'], env)).exitCode).toBe(0)

      expect((await runCli(['discard', discardTarget.operationId, '--reason', 'invalid request'], env)).exitCode).toBe(
        0,
      )

      const collection = await createCollectionDeadLetter()
      const inspection = await runCli(['inspect', collection.operationId], env)

      expect(inspection.exitCode, inspection.stderr).toBe(0)
      expect(JSON.parse(inspection.stdout)).toMatchObject({ ok: true, data: { statisticsEffects: [] } })

      const sealedCollection = await createCollectionDeadLetter()

      await sealCollection(sealedCollection.effectOperationId)

      const sealedReplay = await runCli(['replay', sealedCollection.operationId, '--reason', 'source repaired'], env)

      expect(sealedReplay.exitCode).toBe(1)

      expect(JSON.parse(sealedReplay.stderr)).toEqual({
        ok: false,
        error: { code: 'operation_failed', message: 'dead-letter operation failed' },
      })

      const restricted = postgres(operatorUrl.toString(), { max: 1 })

      try {
        await expect((async () => restricted`DELETE FROM refresh_operations.operations`)()).rejects.toMatchObject({
          code: '42501',
        })

        await expect(
          (async () => restricted`UPDATE refresh_operations.dead_letter_actions SET reason = 'tampered'`)(),
        ).rejects.toMatchObject({ code: '42501' })
      } finally {
        await restricted.end()
      }
    } finally {
      const owner = postgres(connectionString, { max: 1 })

      await owner.unsafe(`DROP OWNED BY ${role}`)
      await owner.unsafe(`DROP ROLE IF EXISTS ${role}`)
      await owner.end()
      rmSync(secretRoot, { force: true, recursive: true })
    }
  }, 15_000)

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

    const { operationId } = await createDeadLetter('cli-sensitive-payload')
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

  test('needs nothing from the environment but its own variables', async () => {
    const rawToken = `raw-secret-${randomUUID()}`
    const { operationId } = await createDeadLetter('minimal-environment')

    const cli = Bun.spawn(['bun', 'apps/api/src/dead-letter-cli.ts', 'inspect', operationId], {
      cwd: repositoryRoot,
      env: { PATH: process.env.PATH ?? '', ...operatorEnv(rawToken) },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      cli.exited,
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
    ])

    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, data: { operation: { operationId } } })
  })
})
