import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export type Sql = postgres.Sql
export type TransactionSql = postgres.TransactionSql

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
  const db = drizzle(sql)

  return {
    sql,
    db,
    close: () => sql.end({ timeout: closeTimeoutSeconds }),
  }
}

function sessionSettings(options: CreateDatabaseOptions): Record<string, string> {
  const settings: Record<string, string> = { application_name: options.applicationName }

  if (options.statementTimeoutMs !== undefined) {
    settings.statement_timeout = String(options.statementTimeoutMs)
  }

  return settings
}
