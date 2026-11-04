import { integer, pgTable } from 'drizzle-orm/pg-core'

export const profiles = pgTable('profiles', { id: integer('id') })
