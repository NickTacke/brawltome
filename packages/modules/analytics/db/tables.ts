import { date, pgSchema, text } from 'drizzle-orm/pg-core'

export const analyticsSchema = pgSchema('analytics')

// one row per utc day that has had a page view; salt is 32 random bytes as hex. the migration makes the table
// unlogged, so the secret never reaches the write-ahead log
export const dailySalts = analyticsSchema.table('daily_salts', {
  day: date('day', { mode: 'string' }).primaryKey(),
  salt: text('salt').notNull(),
})
