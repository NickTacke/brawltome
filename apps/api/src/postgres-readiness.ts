import postgres from 'postgres'

type ExpectedMigration = {
  identity: string
  checksum: string
}

type AppliedMigration = {
  identity: string
  checksum: string
}

/**
 * Later rows are compatible only during an expand-first rollout. Contract or destructive
 * migrations require a coordinated compatibility fence before old replicas may overlap.
 */
export function assertKnownMigrationsApplied(
  expected: readonly ExpectedMigration[],
  applied: readonly AppliedMigration[],
): void {
  const appliedChecksums = new Map(applied.map(({ identity, checksum }) => [identity, checksum.trim()]))

  for (const migration of expected) {
    const appliedChecksum = appliedChecksums.get(migration.identity)
    if (appliedChecksum === undefined) {
      throw new Error(`schema migration ${migration.identity} is not applied`)
    }
    if (appliedChecksum !== migration.checksum) {
      throw new Error(`schema checksum mismatch for ${migration.identity}`)
    }
  }
}

export function createPostgresReadiness(connectionString: string, expectedMigrations: readonly ExpectedMigration[]) {
  const client = postgres(connectionString, { max: 1, connect_timeout: 5 })

  return {
    async check(): Promise<void> {
      const rows = await client<AppliedMigration[]>`
        SELECT identity, checksum
        FROM brawltome_migrations.history
      `
      assertKnownMigrationsApplied(expectedMigrations, rows)
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 })
    },
  }
}

export type PostgresReadiness = ReturnType<typeof createPostgresReadiness>
