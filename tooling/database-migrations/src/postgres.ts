import postgres from 'postgres'
import { type AppliedMigration, type Migration, buildMigrationPlan } from './plan'
import { runMigrations } from './run'

const advisoryLockKey = 1_113_282_925

export async function migratePostgres(connectionString: string, migrations: readonly Migration[]): Promise<number> {
  buildMigrationPlan(migrations, [])

  const client = postgres(connectionString, { max: 1 })
  let lockAcquired = false
  let appliedCount = 0
  let primaryFailure: unknown
  let cleanupFailure: unknown

  try {
    await client.unsafe('SET statement_timeout = 30000')
    await client`SELECT pg_advisory_lock(${advisoryLockKey})`
    lockAcquired = true
    await client.unsafe('SET statement_timeout = 0')

    await client`CREATE SCHEMA IF NOT EXISTS brawltome_migrations`
    await client`
      CREATE TABLE IF NOT EXISTS brawltome_migrations.history (
        ordinal integer PRIMARY KEY,
        identity text NOT NULL UNIQUE,
        predecessor text,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `

    appliedCount = await runMigrations({
      migrations,
      loadApplied: async () => {
        const rows = await client<{ identity: string; checksum: string }[]>`
          SELECT identity, checksum
          FROM brawltome_migrations.history
          ORDER BY ordinal
        `
        return rows.map((row): AppliedMigration => ({ identity: row.identity, checksum: row.checksum.trim() }))
      },
      execute: async (migration, ordinal) => {
        await client.begin(async (transaction) => {
          await transaction.unsafe(migration.sql)
          await transaction.unsafe(
            `INSERT INTO brawltome_migrations.history (ordinal, identity, predecessor, checksum)
             VALUES ($1, $2, $3, $4)`,
            [ordinal, migration.identity, migration.predecessor, migration.checksum],
          )
        })
      },
    })
  } catch (error) {
    primaryFailure = error
  } finally {
    if (lockAcquired) {
      try {
        await client`SELECT pg_advisory_unlock(${advisoryLockKey})`
      } catch (error) {
        cleanupFailure = error
      }
    }
    try {
      await client.end()
    } catch (error) {
      cleanupFailure ??= error
    }
  }

  if (primaryFailure) throw primaryFailure
  if (cleanupFailure) throw cleanupFailure
  return appliedCount
}
