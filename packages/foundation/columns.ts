import { customType } from 'drizzle-orm/pg-core'

// drizzle's own json and jsonb columns turn the value into a json string, and the shared postgres.js client
// serializes that string again, so the database stores a json string instead of the document. these columns hand
// the value to postgres.js as it is, which serializes it once and parses it back on reads.
// a top-level boolean, or an array that starts with one, fails to insert: postgres.js sends it as a boolean

/** A jsonb column for tables queried through the shared client's drizzle instance. */
export function jsonb<Data>(name: string) {
  const column = customType<{ data: Data; driverData: Data }>({
    dataType: () => 'jsonb',
    toDriver: (value) => value,
  })

  return column(name)
}

/** A json column for tables queried through the shared client's drizzle instance. */
export function json<Data>(name: string) {
  const column = customType<{ data: Data; driverData: Data }>({
    dataType: () => 'json',
    toDriver: (value) => value,
  })

  return column(name)
}
