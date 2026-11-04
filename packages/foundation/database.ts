import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export type Sql = postgres.Sql
export type TransactionSql = postgres.TransactionSql
export type JsonValue = postgres.JSONValue

export type Database = {
  sql: Sql
  db: PostgresJsDatabase
  close(): Promise<void>
}

export type CreateDatabaseOptions = {
  maxConnections: number
  applicationName: string
  statementTimeoutMs?: number
}

const closeTimeoutSeconds = 5

/** One postgres.js client plus a drizzle instance over the same connections. */
export function createDatabase(connectionString: string, options: CreateDatabaseOptions): Database {
  const sql = postgres(connectionString, {
    max: options.maxConnections,
    connection: sessionSettings(options),
  })
  const db = drizzle(withOwnParsers(sql))

  return {
    sql,
    db,
    close: () => sql.end({ timeout: closeTimeoutSeconds }),
  }
}

// drizzle swaps its client's date and json parsers and serializers for pass-throughs; on the shared client that would
// hand every module date strings instead of Date objects and reject Date parameters. drizzle gets a view of the client
// with its own copy of the tables, so it runs on the same connections while sql keeps the postgres.js defaults.
// drizzle therefore reads the values postgres.js parses (Date objects, parsed json).
function withOwnParsers(sql: Sql): Sql {
  const options = {
    ...sql.options,
    parsers: { ...sql.options.parsers },
    serializers: { ...sql.options.serializers },
  }

  return Object.assign(Object.create(sql), { options })
}

function sessionSettings(options: CreateDatabaseOptions): Record<string, string> {
  const settings: Record<string, string> = { application_name: options.applicationName }

  if (options.statementTimeoutMs !== undefined) {
    settings.statement_timeout = String(options.statementTimeoutMs)
  }

  return settings
}
