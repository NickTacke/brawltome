import { type SQL, sql } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'

// drizzle's own json and jsonb columns turn the value into a json string, and the shared postgres.js client
// serializes that string again, so the database stores a json string instead of the document. postgres.js also
// types booleans, Dates, bytes and bigints itself, so even a raw value can reach Postgres as the wrong type.
// these columns send the json text as a text parameter, which postgres.js passes through untouched, and cast it
// in sql; reads come back parsed by postgres.js
function jsonText(value: unknown, columnType: 'json' | 'jsonb'): SQL {
  const text = JSON.stringify(value)

  return columnType === 'jsonb' ? sql`${text}::text::jsonb` : sql`${text}::text::json`
}

/** A jsonb column for tables queried through the shared client's drizzle instance. */
export function jsonb<Data>(name: string) {
  const column = customType<{ data: Data; driverData: Data }>({
    dataType: () => 'jsonb',
    toDriver: (value) => jsonText(value, 'jsonb'),
  })

  return column(name)
}

/** A json column for tables queried through the shared client's drizzle instance. */
export function json<Data>(name: string) {
  const column = customType<{ data: Data; driverData: Data }>({
    dataType: () => 'json',
    toDriver: (value) => jsonText(value, 'json'),
  })

  return column(name)
}
