import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createPostgresDiscovery, discoveryMigrationInventory } from '@brawltome/discovery/composition'
import postgres from 'postgres'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `brawltome_discovery_${process.pid}_${randomUUID().replaceAll('-', '')}`
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

const playerResults = async (discovery: ReturnType<typeof createPostgresDiscovery>, query: string) =>
  (await discovery.search(query)).players

const fact = (
  brawlhallaId: number,
  name: string,
  rating: number | null,
  viewCount: number,
  aliases: string[] = [],
) => ({
  brawlhallaId,
  name,
  region: 'US-E',
  rating,
  viewCount,
  bestLegendNameKey: null,
  aliases,
})

describe('Discovery player search', () => {
  test('normalizes terms and orders exact matches before prefixes across canonical, segment, and alias terms', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    try {
      await discovery.rebuildPlayers({
        sourceVersion: 1,
        facts: [
          fact(90, 'Team | Alpha Prime', 2500, 100),
          fact(40, 'Alpha', 1800, 10),
          fact(30, 'Canonical Prefix', 3000, 500, ['Alpha']),
          fact(20, 'Alpha Two', 2600, 200),
        ],
      })

      await expect(playerResults(discovery, '  ALPHA  ')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 40, matchedAlias: null }),
        expect.objectContaining({ brawlhallaId: 30, matchedAlias: 'Alpha' }),
        expect.objectContaining({ brawlhallaId: 20, matchedAlias: null }),
        expect.objectContaining({ brawlhallaId: 90, matchedAlias: null }),
      ])
      await expect(playerResults(discovery, ' %_\\ ')).resolves.toEqual([])
      await expect(playerResults(discovery, ' team|alpha ')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 90, name: 'Team | Alpha Prime' }),
      ])

      const explain = postgres(connectionString, { max: 1 })
      try {
        const [generation] = await explain<{ generation_id: string }[]>`
          SELECT generation_id FROM discovery.generations WHERE entity_kind = 'player' AND active
        `
        await explain`
          INSERT INTO discovery.terms
            (entity_kind, generation_id, entity_id, term_kind, display_term, normalized_term,
             canonical_name, view_count)
          SELECT 'player', ${generation.generation_id}, 100000 + value, 'canonical',
                 'Noise ' || value, 'noise ' || lpad(value::text, 6, '0'),
                 'Noise ' || value, 0
          FROM generate_series(1, 30000) AS value
        `
        await explain`ANALYZE discovery.terms`
        const plan = await explain`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          WITH candidates AS (
            SELECT term.*,
                   term.normalized_term = 'alpha' COLLATE "C" AS exact_match,
                   CASE WHEN term.term_kind = 'alias' THEN 1 ELSE 0 END AS alias_rank,
                   CASE term.term_kind WHEN 'canonical' THEN 0 WHEN 'segment' THEN 1 ELSE 2 END AS stable_term_rank
            FROM discovery.terms term
            JOIN discovery.generations generation
              ON generation.entity_kind = term.entity_kind
             AND generation.generation_id = term.generation_id AND generation.active
            WHERE term.entity_kind = 'player'
              AND term.normalized_term >= 'alpha' COLLATE "C"
              AND term.normalized_term < ${'alpha\u{10ffff}'} COLLATE "C"
          ), winners AS (
            SELECT DISTINCT ON (entity_id) *
            FROM candidates
            ORDER BY entity_id, exact_match DESC, alias_rank, stable_term_rank,
                     normalized_term, display_term
          )
          SELECT entity_id, canonical_name, region, rating, view_count,
                 best_legend_name_key, term_kind, display_term
          FROM winners
          ORDER BY exact_match DESC, alias_rank, rating DESC NULLS LAST,
                   view_count DESC, entity_id
          LIMIT 40
        `
        const serializedPlan = JSON.stringify(plan)
        expect(serializedPlan).toContain('discovery_terms_prefix')
        expect(serializedPlan).not.toContain('Seq Scan on terms')
      } finally {
        await explain.end()
      }
    } finally {
      await discovery.close()
    }
  })

  test('deduplicates identities, caps stable ties at 40, and replays events idempotently', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    try {
      const stableTies = Array.from({ length: 45 }, (_, index) => fact(100 + index, `Prefix ${index}`, 2000, 50))
      await discovery.rebuildPlayers({ sourceVersion: 2, facts: [...stableTies].reverse() })

      const capped = await playerResults(discovery, 'prefix')
      expect(capped).toHaveLength(40)
      expect(capped.map(({ brawlhallaId }) => brawlhallaId)).toEqual(
        Array.from({ length: 40 }, (_, index) => 100 + index),
      )

      const eventId = randomUUID()
      const event = {
        eventId,
        brawlhallaId: 999,
        sourceVersion: 3,
        fact: fact(999, 'Replay Target', 2100, 70, ['Prefix', 'Prefix Previous']),
      }
      await expect(discovery.applyPlayerEvents([event, event])).resolves.toEqual({ appliedEvents: 1 })
      await expect(discovery.applyPlayerEvents([event])).resolves.toEqual({ appliedEvents: 0 })

      const prefixHits = await playerResults(discovery, 'prefix')
      expect(prefixHits.filter(({ brawlhallaId }) => brawlhallaId === 999)).toHaveLength(1)
      expect(prefixHits.find(({ brawlhallaId }) => brawlhallaId === 999)?.matchedAlias).toBe('Prefix')

      await discovery.rebuildPlayers({ sourceVersion: 4, facts: [fact(777, 'Replacement', null, 0)] })
      await expect(playerResults(discovery, 'prefix')).resolves.toEqual([])
      await expect(playerResults(discovery, 'replacement')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 777, rating: null }),
      ])
    } finally {
      await discovery.close()
    }
  })

  test('publishes a production-shaped player generation without per-entity database round trips', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    try {
      const facts = Array.from({ length: 10_001 }, (_, index) =>
        fact(1_000_000 + index, `Scale Player ${index}`, 2000 + (index % 100), index, [`Former ${index}`]),
      )
      await discovery.rebuildPlayers({ sourceVersion: 5, facts })

      await expect(playerResults(discovery, 'scale player 10000')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 1_010_000, matchedAlias: null }),
      ])
      await expect(playerResults(discovery, 'former 10000')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 1_010_000, matchedAlias: 'Former 10000' }),
      ])
    } finally {
      await discovery.close()
    }
  }, 20_000)

  test('uses the durable source watermark so delayed events and stale rebuilds cannot overwrite newer facts', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    try {
      await discovery.rebuildPlayers({ sourceVersion: 10, facts: [fact(500, 'Newest Name', 2200, 10)] })

      await expect(
        discovery.applyPlayerEvents([
          {
            eventId: randomUUID(),
            brawlhallaId: 500,
            sourceVersion: 9,
            fact: fact(500, 'Older Name', 1800, 1),
          },
        ]),
      ).resolves.toEqual({ appliedEvents: 1 })
      await expect(playerResults(discovery, 'newest')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 500, name: 'Newest Name', rating: 2200 }),
      ])
      await expect(
        discovery.rebuildPlayers({ sourceVersion: 9, facts: [fact(500, 'Stale Rebuild', 1700, 0)] }),
      ).rejects.toThrow()
      await expect(playerResults(discovery, 'newest')).resolves.toHaveLength(1)
    } finally {
      await discovery.close()
    }
  })
})
