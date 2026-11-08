import { type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/** The value an upsert tried to insert into the column, for use in its on conflict clause. */
export function excluded(column: PgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`
}
