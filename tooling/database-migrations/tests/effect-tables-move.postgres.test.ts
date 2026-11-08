import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { migratePostgres } from '@brawltome/foundation'
import postgres from 'postgres'
import { orderedMigrations } from '../src/inventories'

// the release being replaced: its statements name the old tables, and it may be serving while this migrates
const movingIdentities = new Set(['players/0021'])

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

function urlForDatabase(name: string): string {
  const url = new URL(serverUrl as string)

  url.pathname = `/${name}`

  return url.toString()
}

async function seedRowsBeforeTheMove(): Promise<void> {
  await owner`
    INSERT INTO refresh_operations.primary_monitoring_reconciliation (singleton, observed_at)
    VALUES (true, ${watermark})
  `
}

async function readWatermarkForUpdate(sql: postgres.Sql | postgres.TransactionSql): Promise<Date | undefined> {
  const [previous] = await sql<{ observed_at: Date }[]>`
    SELECT observed_at
    FROM refresh_operations.primary_monitoring_reconciliation
    WHERE singleton
    FOR UPDATE
  `

  return previous?.observed_at
}

async function upsertWatermark(sql: postgres.Sql | postgres.TransactionSql, observedAt: Date): Promise<void> {
  await sql`
    INSERT INTO refresh_operations.primary_monitoring_reconciliation (singleton, observed_at)
    VALUES (true, ${observedAt})
    ON CONFLICT (singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at
  `
}

async function prepareOldStatements(): Promise<void> {
  await oldRelease.begin(async (transaction) => {
    await readWatermarkForUpdate(transaction)
    await upsertWatermark(transaction, watermark)
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
  describe('players.primary_monitoring_reconciliation', () => {
    test('owner schema holds the row seeded before the move', async () => {
      const [row] = await owner<{ observed_at: Date }[]>`
        SELECT observed_at FROM players.primary_monitoring_reconciliation WHERE singleton
      `

      expect(row.observed_at).toEqual(watermark)
    })

    test('old name is a view that accepts the old statements from a session prepared before the move', async () => {
      const newer = new Date(watermark.getTime() + 1_000)

      await oldRelease.begin(async (transaction) => {
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

      await owner.begin(async (transaction) => {
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
