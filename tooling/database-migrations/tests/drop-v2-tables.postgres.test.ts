import { afterEach, describe, expect, test } from 'bun:test'
import { migratePostgres } from '@brawltome/foundation'
import { type TestDatabase, createTestDatabase } from '@brawltome/foundation/testing'
import postgres from 'postgres'
import { orderedMigrations } from '../src/inventories'

// the V2 tables the module migrations read or put triggers on, in the shape V2 left them
const v2Tables = `
  CREATE TABLE public.player (
    brawlhalla_id integer PRIMARY KEY,
    name text NOT NULL,
    region text,
    rating integer NOT NULL DEFAULT 0,
    view_count integer NOT NULL DEFAULT 0
  );
  CREATE TABLE public.player_alias (
    brawlhalla_id integer NOT NULL REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (brawlhalla_id, key)
  );
  CREATE TABLE public.legend (legend_id integer PRIMARY KEY);
  CREATE SCHEMA drizzle;
  CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL);
`

let database: TestDatabase | undefined

async function withV2Database(): Promise<{ database: TestDatabase; sql: postgres.Sql }> {
  database = await createTestDatabase({ label: 'drop_v2_tables', modules: [] })

  const sql = postgres(database.connectionString, { max: 1 })

  await sql.unsafe(v2Tables)

  return { database, sql }
}

async function relationName(sql: postgres.Sql, name: string): Promise<string | null> {
  const [row] = await sql<{ name: string | null }[]>`SELECT to_regclass(${name})::text AS name`

  return row?.name ?? null
}

afterEach(async () => {
  await database?.drop()
  database = undefined
})

describe('dropping the V2 tables', () => {
  test('removes the V2 tables, the drizzle schema and the V2 auth state', async () => {
    const { database, sql } = await withV2Database()

    try {
      await migratePostgres(database.connectionString, orderedMigrations)

      const publicTables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
      const [drizzle] = await sql<{ name: string | null }[]>`SELECT to_regnamespace('drizzle')::text AS name`

      const importedColumn = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'accounts' AND table_name = 'sessions' AND column_name = 'imported_from_v2'
      `

      expect([...publicTables]).toEqual([])
      expect(drizzle?.name).toBeNull()
      expect(await relationName(sql, 'accounts.v2_auth_cutover')).toBeNull()
      expect([...importedColumn]).toEqual([])
    } finally {
      await sql.end()
    }
  }, 30_000)

  test('keeps the discovery outbox firing for the players tables', async () => {
    const { database, sql } = await withV2Database()

    try {
      await migratePostgres(database.connectionString, orderedMigrations)

      await sql`
        INSERT INTO players.ranked_profiles
          (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
        VALUES (42, 'After V2', now(), now(), 'EU', 2000, 2100, 'Diamond', 1, 2)
      `

      const facts = await sql<{ brawlhalla_id: number }[]>`SELECT brawlhalla_id FROM players.discovery_outbox`

      expect(facts.map(({ brawlhalla_id }) => brawlhalla_id)).toContain(42)
    } finally {
      await sql.end()
    }
  }, 30_000)

  test('fails without dropping anything when an object outside V2 still depends on its tables', async () => {
    const { database, sql } = await withV2Database()

    try {
      await sql`CREATE SCHEMA reporting`
      await sql`CREATE VIEW reporting.player_names AS SELECT name FROM public.player`

      await expect(migratePostgres(database.connectionString, orderedMigrations)).rejects.toThrow(
        'other objects depend on',
      )

      expect(await relationName(sql, 'public.player')).toBe('player')
    } finally {
      await sql.end()
    }
  }, 30_000)
})
