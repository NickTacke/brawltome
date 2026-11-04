import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const client = postgres(connectionString)

export const db = drizzle(client)

export async function closeDatabase(): Promise<void> {
  await client.end({ timeout: 5 })
}

export type Database = typeof db
