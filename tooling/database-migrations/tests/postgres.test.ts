import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { globalMigrationInventory } from '../src/inventories'
import { type Migration, checksumSql } from '../src/plan'
import { migratePostgres } from '../src/postgres'

const connectionString = process.env.DATABASE_URL

describe.skipIf(!connectionString)('PostgreSQL migration runner', () => {
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
      expect(applications.sort()).toEqual([0, 2])
      expect(await migratePostgres(databaseUrl.toString(), globalMigrationInventory)).toBe(0)

      const failingSql = 'CREATE TABLE players.rollback_probe (id integer); SELECT * FROM players.missing_table;'
      const failingMigration: Migration = {
        identity: 'players/0002',
        predecessor: 'players/0001',
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
        const [rollbackProbe] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.rollback_probe')::text AS table_name
        `

        expect(history.map(({ identity, checksum }) => ({ identity, checksum: checksum.trim() }))).toEqual(
          globalMigrationInventory.map(({ identity, checksum }) => ({ identity, checksum })),
        )
        expect(schema.exists).toBe(true)
        expect(refreshOperationsSchema.exists).toBe(true)
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
