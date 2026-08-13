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
export function assertKnownSchemaPrefix(
  expected: readonly ExpectedMigration[],
  applied: readonly AppliedMigration[],
): void {
  if (applied.length < expected.length) {
    throw new Error(`schema migration count mismatch: expected at least ${expected.length}, received ${applied.length}`)
  }
  for (const [index, migration] of expected.entries()) {
    const recorded = applied[index]
    if (recorded?.identity !== migration.identity) {
      throw new Error(`schema migration mismatch at ${index}: expected ${migration.identity}`)
    }
    if (recorded.checksum.trim() !== migration.checksum) {
      throw new Error(`schema checksum mismatch for ${migration.identity}`)
    }
  }
}

export function createPostgresReadiness(connectionString: string, expectedMigrations: readonly ExpectedMigration[]) {
  const client = postgres(connectionString, { max: 1, connect_timeout: 5 })
  const owners = new Set(expectedMigrations.map(({ identity }) => identity.split('/')[0]))

  return {
    async check(): Promise<void> {
      const rows = await client<AppliedMigration[]>`
        SELECT identity, checksum
        FROM brawltome_migrations.history
        ORDER BY ordinal
      `
      const relevant = rows.filter(({ identity }) => owners.has(identity.split('/')[0]))
      assertKnownSchemaPrefix(expectedMigrations, relevant)
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 })
    },
  }
}

export type PostgresReadiness = ReturnType<typeof createPostgresReadiness>
