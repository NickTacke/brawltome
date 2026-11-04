import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { ClanProjectionSource } from '@brawltome/discovery'
import { createPostgresDiscovery, discoveryMigrationInventory } from '@brawltome/discovery/composition'
import postgres from 'postgres'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `brawltome_cross_kind_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

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
    throw new Error(`Discovery PostgreSQL tests require the dedicated server ${dedicatedServer}`)
  }
  const adminUrl = new URL(dedicatedServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of discoveryMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
}, 20_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

const player = (brawlhallaId: number, name: string) => ({
  brawlhallaId,
  name,
  region: null,
  rating: 2000,
  viewCount: 10,
  bestLegendNameKey: null,
  aliases: [],
})

const clan = (clanId: number, clanName: string, clanXp: string, memberCount = 0) => ({
  clanId,
  clanName,
  clanXp,
  memberCount,
})

describe('Discovery cross-kind search', () => {
  test('returns type-distinct overlapping identities and ranks clans by exactness, numeric XP, then stable identity', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    try {
      await discovery.rebuildPlayers({ sourceVersion: 1, facts: [player(42, 'Shared Prefix')] })
      await discovery.rebuildClans({
        sourceVersion: 1,
        pendingEventCount: 0,
        oldestPendingAt: null,
        facts: [
          clan(42, 'Shared', '10', 2),
          clan(9, 'Shared', '900719925474099312345', 3),
          clan(7, 'Shared Prefix', '999999999999999999999', 4),
          clan(5, 'Shared', '900719925474099312345', 5),
          clan(11, 'Shared Two', '999999999999999999999', 6),
          clan(13, 'Shared Three', '999999999999999999999', 7),
          clan(15, 'Shared Four', '999999999999999999999', 8),
        ],
      })

      const result = await discovery.search('  SHARED  ')
      expect(result.players).toEqual([expect.objectContaining({ brawlhallaId: 42, name: 'Shared Prefix' })])
      expect(result.clans).toEqual([
        { clanId: 5, clanName: 'Shared', clanXp: '900719925474099312345', memberCount: 5 },
        { clanId: 9, clanName: 'Shared', clanXp: '900719925474099312345', memberCount: 3 },
        { clanId: 42, clanName: 'Shared', clanXp: '10', memberCount: 2 },
        { clanId: 7, clanName: 'Shared Prefix', clanXp: '999999999999999999999', memberCount: 4 },
        { clanId: 11, clanName: 'Shared Two', clanXp: '999999999999999999999', memberCount: 6 },
      ])
      expect(result.clans).toHaveLength(5)
    } finally {
      await discovery.close()
    }
  })

  test('concurrent Clan rebuild and delivery converge on the same current owner fact', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    const currentFact = clan(42, 'Concurrent Current', '12345678901234567890', 9)
    const eventId = randomUUID()
    const acknowledged: string[] = []
    const source: ClanProjectionSource = {
      pendingEvents: async () => [{ eventId, clanId: 42, sourceVersion: 5, fact: currentFact }],
      acknowledgeEvents: async (eventIds) => {
        acknowledged.push(...eventIds)
      },
      snapshot: async () => ({
        sourceVersion: 5,
        pendingEventCount: 1,
        oldestPendingAt: new Date('2024-01-01T00:00:00.000Z'),
        facts: [currentFact],
      }),
      lag: async () => 1,
    }
    try {
      await Promise.all([discovery.deliverPendingClans(source, 100), discovery.rebuildClansFrom(source)])
      expect(acknowledged).toEqual([eventId])
      expect((await discovery.search('concurrent')).clans).toEqual([
        { clanId: 42, clanName: 'Concurrent Current', clanXp: '12345678901234567890', memberCount: 9 },
      ])
    } finally {
      await discovery.close()
    }
  })

  test('uses the cross-kind prefix index for the production Clan query under normal planner settings', async () => {
    const client = postgres(connectionString, { max: 1 })
    try {
      const [generation] = await client<{ generation_id: string }[]>`
        SELECT generation_id FROM discovery.generations WHERE entity_kind = 'clan' AND active
      `
      await client`
        INSERT INTO discovery.terms
          (entity_kind, generation_id, entity_id, term_kind, display_term, normalized_term,
           canonical_name, clan_xp, member_count)
        SELECT 'clan', ${generation.generation_id}, 100000 + value, 'canonical',
               'Noise Clan ' || value, 'noise clan ' || lpad(value::text, 6, '0'),
               'Noise Clan ' || value, value, 0
        FROM generate_series(1, 15000) AS value
      `
      await client`ANALYZE discovery.terms`
      const plan = await client`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT term.entity_id, term.canonical_name, term.clan_xp::text, term.member_count
        FROM discovery.terms term
        JOIN discovery.generations generation
          ON generation.entity_kind = term.entity_kind
         AND generation.generation_id = term.generation_id AND generation.active
        WHERE term.entity_kind = 'clan'
          AND term.normalized_term >= 'shared' COLLATE "C"
          AND term.normalized_term < ${'shared\u{10ffff}'} COLLATE "C"
        ORDER BY (term.normalized_term = 'shared' COLLATE "C") DESC,
                 term.clan_xp DESC, term.entity_id
        LIMIT 5
      `
      const serializedPlan = JSON.stringify(plan)
      expect(serializedPlan).toContain('discovery_terms_prefix')
      expect(serializedPlan).not.toContain('Seq Scan on terms')
    } finally {
      await client.end()
    }
  })
})
