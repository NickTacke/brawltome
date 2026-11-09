import { type SQL, sql } from 'drizzle-orm'
import { operations } from './tables'

// one condition for each top-level payload key, compared as text
export function payloadMatches(payloadEquals: Record<string, string>): SQL[] {
  return Object.entries(payloadEquals).map(([key, value]) => sql`${operations.payload}->>${key}::text = ${value}`)
}
