import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { importLegacyClans } from '@brawltome/clan/composition'
import { createPostgresDiscovery } from '@brawltome/discovery/composition'
import { importLegacyPlayers } from '@brawltome/player/composition'
import { importLegacyRankings } from '@brawltome/ranking/composition'
import postgres from 'postgres'
import { globalMigrationInventory } from '../src/inventories'
import { migratePostgres } from '../src/postgres'
import { rebuildMigratedDiscovery } from '../src/rebuild-discovery'
import { legacyPlayerRowsSql, legacyPlayerSchemaSql } from './fixtures/legacy-discovery'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
let admin: ReturnType<typeof postgres>

beforeAll(async () => {
  const configured = new URL(configuredServer ?? '')
  const dedicated = new URL(dedicatedServer)
  if (
    configured.protocol !== dedicated.protocol ||
    configured.hostname !== dedicated.hostname ||
    configured.port !== dedicated.port ||
    configured.username !== dedicated.username ||
    configured.password !== dedicated.password
  ) {
    throw new Error(`Discovery rebuild tests require the dedicated server ${dedicatedServer}`)
  }
  const adminUrl = new URL(dedicatedServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
})

afterAll(async () => {
  await admin?.end()
})

async function createFixtureDatabase(): Promise<{ connectionString: string; drop: () => Promise<void> }> {
  const databaseName = `bt_225_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${databaseName}`
  const connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    await setup.unsafe(legacyPlayerSchemaSql)
    await setup.unsafe(`
      CREATE TABLE public.clan (
        clan_id integer PRIMARY KEY,
        clan_name text NOT NULL,
        clan_create_date timestamp NOT NULL,
        clan_xp bigint NOT NULL,
        clan_lifetime_xp bigint NOT NULL,
        last_updated timestamp NOT NULL
      );
      CREATE TABLE public.clan_member (
        clan_id integer NOT NULL REFERENCES public.clan(clan_id) ON DELETE CASCADE,
        brawlhalla_id integer NOT NULL,
        name text NOT NULL,
        rank text NOT NULL,
        join_date timestamp NOT NULL,
        xp integer NOT NULL,
        legend_name_key text,
        PRIMARY KEY (clan_id, brawlhalla_id)
      );
      CREATE TABLE public.player_clan (
        brawlhalla_id integer PRIMARY KEY REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
        clan_name text NOT NULL,
        clan_id integer NOT NULL,
        clan_xp bigint NOT NULL,
        clan_lifetime_xp bigint NOT NULL,
        personal_xp integer NOT NULL
      );
    `)
    await setup.unsafe(legacyPlayerRowsSql)
    await setup.unsafe(`
      INSERT INTO public.player (brawlhalla_id, name, region, rating, peak_rating, tier, ranked_games,
        ranked_wins, synced_at_1v1, rating_3v3, peak_rating_3v3, tier_3v3, wins_3v3, losses_3v3,
        synced_at_3v3)
      VALUES
        (10, 'Alpha', 'EU', 1900, 1950, 'Platinum', 100, 60, '2026-08-01 10:00:00',
         1800, 1850, 'Platinum', 30, 20, '2026-08-01 10:01:00'),
        (11, 'Bravo', 'EU', 1800, 1850, 'Platinum', 80, 40, '2026-08-01 10:05:00',
         1700, 1750, 'Gold', 20, 20, '2026-08-01 10:06:00'),
        (12, 'Charlie', 'EU', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
        (13, 'Delta', 'EU', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
        (14, 'Echo', 'EU', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
        (20, 'Invalid Peak', 'US-E', 1900, 1800, 'Platinum', 20, 10, '2026-08-01 10:00:00',
         0, 0, NULL, 0, 0, NULL),
        (21, 'Foxtrot', 'US-E', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
        (22, 'Golf', 'US-E', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
        (30, 'Orphan Membership', 'EU', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
        (40, 'Tie One', 'AUS', 1700, 1750, 'Gold', 30, 10, '2026-08-01 10:00:00',
         0, 0, NULL, 0, 0, NULL),
        (41, 'Tie Two', 'AUS', 1700, 1760, 'Gold', 30, 10, '2026-08-01 10:01:00',
         0, 0, NULL, 0, 0, NULL);
      UPDATE public.player
      SET last_updated = '2026-08-01 12:00:00', last_viewed_at = '2026-08-01 12:00:00'
      WHERE brawlhalla_id IN (10, 11, 12, 13, 14, 20, 21, 22, 30, 40, 41);

      INSERT INTO public.clan VALUES
        (1, 'Archive Keepers', '2020-01-01', 1000, 5000, '2026-08-01 10:00:00'),
        (2, 'Conflict Clan', '2021-01-01', 2000, 6000, '2026-08-01 11:00:00'),
        (-3, 'Invalid Identity', '2022-01-01', 1, 1, '2026-08-01 12:00:00');
      INSERT INTO public.clan_member VALUES
        (1, 10, 'Alpha', 'Leader', '2020-01-02', 500, 'bodvar'),
        (2, 20, 'Invalid Peak', 'Member', '2021-01-02', 200, NULL),
        (-3, 21, 'Foxtrot', 'Leader', '2022-01-02', 1, NULL);
      INSERT INTO public.player_clan VALUES
        (10, 'Archive Keepers', 1, 1000, 5000, 500),
        (20, 'Conflict Clan', 2, 2000, 6000, 999),
        (30, 'Missing Clan', 999, 1, 1, 1);
      INSERT INTO public.player_ranked_team
        (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two, team_name, rating, peak_rating, tier,
         wins, games, region, synced_at)
      VALUES
        (12, 12, 13, 'Charlie + Delta', 1850, 1900, 'Platinum', 30, 50, 'EU', '2026-08-01 10:02:00'),
        (13, 12, 13, 'Charlie + Delta', 1850, 1900, 'Platinum', 30, 50, 'EU', '2026-08-01 10:03:00'),
        (14, 14, 0, 'Solo Queue', 1750, 1800, 'Gold', 20, 40, 'EU', '2026-08-01 10:04:00'),
        (21, 21, 22, 'Incomplete Pair', 1600, 1650, 'Gold', 10, 20, 'US-E', '2026-08-01 10:00:00');
    `)
    await migratePostgres(connectionString, globalMigrationInventory)
    expect((await importLegacyPlayers(connectionString)).status).toBe('complete')
    expect((await importLegacyClans(connectionString)).status).toBe('complete')
    expect((await importLegacyRankings(connectionString)).status).toBe('complete')
  } finally {
    await setup.end()
  }
  return {
    connectionString,
    drop: () => admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).then(() => undefined),
  }
}

async function rehearsal() {
  const fixture = await createFixtureDatabase()
  try {
    return await rebuildMigratedDiscovery(fixture.connectionString)
  } finally {
    await fixture.drop()
  }
}

describe('migrated Discovery rebuild', () => {
  test('restarts after a crash, converges concurrently, repairs orphans, and records every semantic class', async () => {
    const fixture = await createFixtureDatabase()
    const control = postgres(fixture.connectionString)
    const discovery = createPostgresDiscovery(fixture.connectionString)
    try {
      await control.unsafe(`
        CREATE FUNCTION discovery.fail_first_semantic_evidence() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture semantic evidence crash'; END; $$;
        CREATE TRIGGER fail_first_semantic_evidence
        BEFORE INSERT ON discovery.semantic_migration_runs
        FOR EACH ROW EXECUTE FUNCTION discovery.fail_first_semantic_evidence();
      `)
      await expect(rebuildMigratedDiscovery(fixture.connectionString)).rejects.toThrow(
        'fixture semantic evidence crash',
      )
      expect((await discovery.search('forty two')).players.map(({ brawlhallaId }) => brawlhallaId)).toContain(42)
      await control.unsafe(`
        DROP TRIGGER fail_first_semantic_evidence ON discovery.semantic_migration_runs;
        DROP FUNCTION discovery.fail_first_semantic_evidence();
      `)

      const [first, concurrent] = await Promise.all([
        rebuildMigratedDiscovery(fixture.connectionString),
        rebuildMigratedDiscovery(fixture.connectionString),
      ])
      expect(concurrent).toEqual(first)
      expect(first).toMatchObject({
        status: 'passed',
        pendingPlayerEvents: 0,
        pendingClanEvents: 0,
        unexplainedMismatchCount: 0,
      })
      expect(first.intentionalDifferenceCount).toBeGreaterThan(0)
      expect(first.semanticCounts).toEqual({
        'canonical-identity': 15,
        'exact-prefix': 15,
        'normalized-exact-name': 1,
        'local-name': 1,
        'negative-legacy-only': 1,
        'preserved-route': 15,
        'ranking-accepted': 3,
        'ranking-rejected': 33,
      })

      const [generation] = await control<{ generation_id: string }[]>`
        SELECT generation_id FROM discovery.generations WHERE entity_kind = 'player' AND active
      `
      await control`
        INSERT INTO discovery.terms
          (entity_kind, generation_id, entity_id, term_kind, display_term, normalized_term,
           canonical_name, view_count)
        VALUES ('player', ${generation.generation_id}, 999999, 'canonical', 'Legacy Only Orphan',
                'legacy only orphan', 'Legacy Only Orphan', 0)
      `
      expect((await discovery.search('legacy only orphan')).players).toHaveLength(1)
      expect(await rebuildMigratedDiscovery(fixture.connectionString)).toEqual(first)
      expect((await discovery.search('legacy only orphan')).players).toEqual([])

      const [evidence] = await control<{ run_id: string; fixture_manifest: unknown[] }[]>`
        SELECT run_id, fixture_manifest FROM discovery.semantic_migration_runs
      `
      expect(evidence.fixture_manifest).toHaveLength(first.fixtureCount)
      expect(
        evidence.fixture_manifest.some((fixture) => {
          const item = fixture as { legacy?: unknown; actual?: unknown }
          return JSON.stringify(item.legacy) !== JSON.stringify(item.actual)
        }),
      ).toBe(true)
      await expect(
        Promise.resolve(
          control`UPDATE discovery.semantic_migration_runs SET status = 'blocked' WHERE run_id = ${evidence.run_id}`,
        ),
      ).rejects.toThrow('Discovery semantic migration evidence is immutable')
    } finally {
      await Promise.all([control.end(), discovery.close()])
      await fixture.drop()
    }
  }, 90_000)

  test('produces identical deterministic evidence in two dedicated PostgreSQL rehearsals', async () => {
    const [first, second] = await Promise.all([rehearsal(), rehearsal()])
    expect(second).toEqual(first)
    expect(first.status).toBe('passed')
  }, 120_000)
})
