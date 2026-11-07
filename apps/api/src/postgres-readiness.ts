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
 * Every migration this process loads must be applied with the same checksum. History rows it doesn't know, such
 * as a newer release's migrations or those of modules it doesn't load, are ignored. That is safe only while
 * migrations expand first: a contract or destructive migration needs the old replicas gone before it runs.
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

type CancellableQuery<T> = Promise<T> & { cancel(): unknown }

// a timed-out probe is cancelled: postgres.js drops it from the queue if it hasn't started, so probes made while the
// pool is saturated don't pile up behind each other
async function withinTimeout<T>(query: CancellableQuery<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      cancelQuietly(query)

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

// postgres.js types cancel() as void but returns a promise that rejects if the cancel request itself fails; the probe
// has already failed by then, so that error has nothing left to report to
function cancelQuietly(query: CancellableQuery<unknown>): void {
  Promise.resolve(query.cancel()).catch(() => undefined)
}

export type PostgresReadiness = ReturnType<typeof createPostgresReadiness>
