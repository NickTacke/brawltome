import type { Sql } from '@brawltome/foundation'

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

// below Docker's 3 s health check timeout, so a busy pool reports unready instead of a hung probe
export const readinessTimeoutMs = 2_000

export type PostgresReadinessOptions = {
  timeoutMs?: number
}

// runs on the process's own client: a pool too busy to answer in time is a dependency that isn't ready
export function createPostgresReadiness(
  sql: Sql,
  expectedMigrations: readonly ExpectedMigration[],
  { timeoutMs = readinessTimeoutMs }: PostgresReadinessOptions = {},
) {
  return {
    async check(): Promise<void> {
      const rows = await withinTimeout(
        sql<AppliedMigration[]>`
          SELECT identity, checksum
          FROM brawltome_migrations.history
        `,
        timeoutMs,
      )

      assertKnownMigrationsApplied(expectedMigrations, rows)
    },
  }
}

// the query stays queued after a timeout and settles on its own; it's a single small read
async function withinTimeout<T>(query: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `postgres readiness: the database did not answer within ${timeoutMs} ms (pool busy or database unreachable)`,
        ),
      )
    }, timeoutMs)
  })

  try {
    return await Promise.race([query, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

export type PostgresReadiness = ReturnType<typeof createPostgresReadiness>
