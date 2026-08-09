import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { refreshOperationsMigrationInventory } from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { globalMigrationInventory } from '../src/inventories'
import { type Migration, checksumSql } from '../src/plan'
import { migratePostgres } from '../src/postgres'

const connectionString = process.env.DATABASE_URL

describe.skipIf(!connectionString)('PostgreSQL migration runner', () => {
  test('inventories refresh migrations as the stable 0001 through 0004 chain', () => {
    expect(refreshOperationsMigrationInventory.map(({ identity }) => identity)).toEqual([
      'refresh-operations/0001',
      'refresh-operations/0002',
      'refresh-operations/0003',
      'refresh-operations/0004',
    ])
  })

  test('appends interactive migrations after an applied scheduling prefix', async () => {
    const databaseName = `brawltome_migration_prefix_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory.slice(0, 2))).toBe(2)
      expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory)).toBe(2)
      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const history = await client<{ identity: string }[]>`
          SELECT identity FROM brawltome_migrations.history ORDER BY ordinal
        `
        expect(history.map(({ identity }) => identity)).toEqual(
          refreshOperationsMigrationInventory.map(({ identity }) => identity),
        )
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  })

  test('serializes fresh runners, applies once, reruns as a no-op, and rolls back failures', async () => {
    const databaseName = `brawltome_migrations_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      const applications = await Promise.all([
        migratePostgres(databaseUrl.toString(), globalMigrationInventory),
        migratePostgres(databaseUrl.toString(), globalMigrationInventory),
      ])
      expect(applications.sort()).toEqual([0, globalMigrationInventory.length])
      expect(await migratePostgres(databaseUrl.toString(), globalMigrationInventory)).toBe(0)

      const failingSql = 'CREATE TABLE players.rollback_probe (id integer); SELECT * FROM players.missing_table;'
      const failingMigration: Migration = {
        identity: 'players/0003',
        predecessor: 'players/0002',
        checksum: checksumSql(failingSql),
        sql: failingSql,
      }
      await expect(
        migratePostgres(databaseUrl.toString(), [...globalMigrationInventory, failingMigration]),
      ).rejects.toThrow()

      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const history = await client<{ identity: string; checksum: string }[]>`
          SELECT identity, checksum
          FROM brawltome_migrations.history
          ORDER BY ordinal
        `
        const [schema] = await client<{ exists: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'players') AS exists
        `
        const [refreshOperationsSchema] = await client<{ exists: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'refresh_operations') AS exists
        `
        const [requestAdmissionSchema] = await client<{ exists: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'request_admission') AS exists
        `
        const [playerRefreshEffects] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.interactive_refresh_effects')::text AS table_name
        `
        const [rollbackProbe] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.rollback_probe')::text AS table_name
        `

        expect(history.map(({ identity, checksum }) => ({ identity, checksum: checksum.trim() }))).toEqual(
          globalMigrationInventory.map(({ identity, checksum }) => ({ identity, checksum })),
        )
        expect(schema.exists).toBe(true)
        expect(refreshOperationsSchema.exists).toBe(true)
        expect(requestAdmissionSchema.exists).toBe(true)
        expect(playerRefreshEffects.table_name).toBe('players.interactive_refresh_effects')
        expect(rollbackProbe.table_name).toBeNull()
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  })
})
