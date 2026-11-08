import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { migratePostgres } from '@brawltome/foundation'
import postgres from 'postgres'
import { orderedMigrations } from '../src/inventories'

// the release being replaced: its statements name the old tables, and it may be serving while this migrates
const movingIdentities = new Set(['accounts/0011', 'players/0021'])

const serverUrl = process.env.DATABASE_URL
const describeWithDatabase = serverUrl ? describe : describe.skip

const databaseName = `effect_move_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)
const runtimeRole = `effect_runtime_${randomUUID().replaceAll('-', '')}`.slice(0, 63)

let databaseUrl: string
let owner: postgres.Sql
// one connection, so the statements it prepared before the move are still cached after it
let oldRelease: postgres.Sql
let admin: postgres.Sql

const watermark = new Date('2026-08-10T00:00:00.000Z')

const proofOperationId = randomUUID()
const proofOperationKey = `proof:${proofOperationId}`
const proofPayload = { value: 'seeded proof' }

function urlForDatabase(name: string): string {
  const url = new URL(serverUrl as string)

  url.pathname = `/${name}`

  return url.toString()
}

type LeasedOperation = {
  id: string
  kind: string
  operationKey: string
  payload: Record<string, unknown>
  status?: string
}

type OldRunner = postgres.Sql

async function insertOperation(operation: LeasedOperation): Promise<void> {
  await owner`
    INSERT INTO refresh_operations.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
       status, attempt_count, max_attempts, lease_token, lease_owner, lease_expires_at)
    VALUES (${operation.id}, ${operation.id}, ${operation.kind}, ${`dedupe:${operation.id}`}, ${operation.operationKey},
            'maintenance', ${owner.json(operation.payload as never)},
            ${owner.json({ source: 'effect-tables-move-test', requestedBy: 'test' })},
            ${operation.status ?? 'leased'}, 1, 3, 1, 'old-release-worker', clock_timestamp() + interval '1 hour')
  `
}

async function seedRowsBeforeTheMove(): Promise<void> {
  await insertOperation({
    id: proofOperationId,
    kind: 'proof',
    operationKey: proofOperationKey,
    payload: proofPayload,
  })

  await owner`
    INSERT INTO refresh_operations.proof_effects (operation_key, operation_id, lease_token, effect_value)
    VALUES (${`seeded:${proofOperationKey}`}, ${proofOperationId}, 1, ${owner.json(proofPayload)})
  `

  await owner`
    INSERT INTO refresh_operations.primary_monitoring_reconciliation (singleton, observed_at)
    VALUES (true, ${watermark})
  `
}

async function readWatermarkForUpdate(sql: OldRunner): Promise<Date | undefined> {
  const [previous] = await sql<{ observed_at: Date }[]>`
    SELECT observed_at
    FROM refresh_operations.primary_monitoring_reconciliation
    WHERE singleton
    FOR UPDATE
  `

  return previous?.observed_at
}

async function upsertWatermark(sql: OldRunner, observedAt: Date): Promise<void> {
  await sql`
    INSERT INTO refresh_operations.primary_monitoring_reconciliation (singleton, observed_at)
    VALUES (true, ${observedAt})
    ON CONFLICT (singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at
  `
}

async function oldProofEffectInsert(sql: OldRunner, operationKey: string, operationId: string) {
  return sql<{ operation_key: string }[]>`
    INSERT INTO refresh_operations.proof_effects (operation_key, operation_id, lease_token, effect_value)
    VALUES (${operationKey}, ${operationId}, ${1}, ${sql.json(proofPayload)})
    ON CONFLICT (operation_key) DO NOTHING
    RETURNING operation_key
  `
}

async function oldProofEffectRead(sql: OldRunner, operationKey: string) {
  const [existing] = await sql<{ operation_id: string; matches_payload: boolean }[]>`
    SELECT operation_id, effect_value = ${sql.json(proofPayload)}::jsonb AS matches_payload
    FROM refresh_operations.proof_effects
    WHERE operation_key = ${operationKey}
  `

  return existing
}

async function oldProofEffectState(sql: OldRunner, effectOperationId: string) {
  return sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.proof_effects
    WHERE operation_id = ${effectOperationId}
  `
}

async function prepareOldStatements(): Promise<void> {
  await oldRelease.begin(async (transactionHandle) => {
    const transaction = transactionHandle as unknown as OldRunner

    await readWatermarkForUpdate(transaction)
    await upsertWatermark(transaction, watermark)
    // the conflict path, so the seeded row stays as it was
    await oldProofEffectInsert(transaction, `seeded:${proofOperationKey}`, proofOperationId)
    await oldProofEffectRead(transaction, `seeded:${proofOperationKey}`)
    await oldProofEffectState(transaction, proofOperationId)
  })
}

beforeAll(async () => {
  if (!serverUrl) return

  admin = postgres(urlForDatabase('postgres'), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  await admin.unsafe(`CREATE ROLE "${runtimeRole}" NOLOGIN NOSUPERUSER`)

  databaseUrl = urlForDatabase(databaseName)
  owner = postgres(databaseUrl, { max: 1 })

  // production grants these once at database creation; every later object inherits them
  await owner.unsafe(`ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO "${runtimeRole}"`)
  await owner.unsafe(`ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${runtimeRole}"`)
  await owner.unsafe(`ALTER DEFAULT PRIVILEGES GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${runtimeRole}"`)

  await migratePostgres(
    databaseUrl,
    orderedMigrations.filter(({ identity }) => !movingIdentities.has(identity)),
  )

  await seedRowsBeforeTheMove()

  oldRelease = postgres(databaseUrl, { max: 1 })
  await prepareOldStatements()

  await migratePostgres(databaseUrl, orderedMigrations)
}, 60_000)

afterAll(async () => {
  if (!serverUrl) return

  await oldRelease?.end()
  await owner?.end()
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin?.unsafe(`DROP ROLE IF EXISTS "${runtimeRole}"`)
  await admin?.end()
}, 30_000)

describeWithDatabase('moving queue effect tables to their owners', () => {
  describe('accounts.proof_effects', () => {
    test('owner schema holds the row seeded before the move', async () => {
      const rows = await owner<{ operation_id: string; effect_value: unknown }[]>`
        SELECT operation_id, effect_value FROM accounts.proof_effects WHERE operation_key = ${`seeded:${proofOperationKey}`}
      `

      expect([...rows]).toEqual([{ operation_id: proofOperationId, effect_value: proofPayload }])
    })

    test('old name is a view that accepts the old statements from a session prepared before the move', async () => {
      const operationKey = `old-release:${randomUUID()}`
      const operationId = randomUUID()

      await insertOperation({ id: operationId, kind: 'proof', operationKey, payload: proofPayload })

      const inserted = await oldProofEffectInsert(oldRelease, operationKey, operationId)

      expect([...inserted]).toEqual([{ operation_key: operationKey }])

      expect([...(await oldProofEffectInsert(oldRelease, operationKey, operationId))]).toEqual([])

      expect(await oldProofEffectRead(oldRelease, operationKey)).toEqual({
        operation_id: operationId,
        matches_payload: true,
      })

      expect([...(await oldProofEffectState(oldRelease, operationId))]).toEqual([{ operation_id: operationId }])

      const [stored] = await owner<{ operation_key: string; created_at: Date }[]>`
        SELECT operation_key, created_at FROM accounts.proof_effects WHERE operation_id = ${operationId}
      `

      expect(stored.operation_key).toBe(operationKey)
      expect(stored.created_at).toBeInstanceOf(Date)
    })

    test('the foreign key to operations still holds at the new name', async () => {
      await expect(oldProofEffectInsert(oldRelease, `orphan:${randomUUID()}`, randomUUID())).rejects.toMatchObject({
        code: '23503',
      })
    })

    test('runtime role reads and writes both names', async () => {
      const operationKey = `runtime:${randomUUID()}`
      const operationId = randomUUID()

      await insertOperation({ id: operationId, kind: 'proof', operationKey, payload: proofPayload })

      await owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE "${runtimeRole}"`)
        await oldProofEffectInsert(transaction, operationKey, operationId)
        await transaction`SELECT operation_id FROM accounts.proof_effects WHERE operation_key = ${operationKey}`
      })
    })
  })

  describe('players.primary_monitoring_reconciliation', () => {
    test('owner schema holds the row seeded before the move', async () => {
      const [row] = await owner<{ observed_at: Date }[]>`
        SELECT observed_at FROM players.primary_monitoring_reconciliation WHERE singleton
      `

      expect(row.observed_at).toEqual(watermark)
    })

    test('old name is a view that accepts the old statements from a session prepared before the move', async () => {
      const newer = new Date(watermark.getTime() + 1_000)

      await oldRelease.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        expect(await readWatermarkForUpdate(transaction)).toEqual(watermark)
        await upsertWatermark(transaction, newer)
      })

      const [viewed] = await owner<{ observed_at: Date }[]>`
        SELECT observed_at FROM refresh_operations.primary_monitoring_reconciliation WHERE singleton
      `

      expect(viewed.observed_at).toEqual(newer)

      const [stored] = await owner<{ observed_at: Date }[]>`
        SELECT observed_at FROM players.primary_monitoring_reconciliation WHERE singleton
      `

      expect(stored.observed_at).toEqual(newer)
    })

    test('runtime role reads and writes both names', async () => {
      const newer = new Date(watermark.getTime() + 2_000)

      await owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE "${runtimeRole}"`)
        await readWatermarkForUpdate(transaction)
        await upsertWatermark(transaction, newer)

        await transaction`
          SELECT observed_at FROM players.primary_monitoring_reconciliation WHERE singleton FOR UPDATE
        `
      })
    })
  })
})
