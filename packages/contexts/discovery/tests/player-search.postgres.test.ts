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

      await expect(discovery.searchPlayers('  ALPHA  ')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 40, matchedAlias: null }),
        expect.objectContaining({ brawlhallaId: 30, matchedAlias: 'Alpha' }),
        expect.objectContaining({ brawlhallaId: 20, matchedAlias: null }),
        expect.objectContaining({ brawlhallaId: 90, matchedAlias: null }),
      ])
      await expect(discovery.searchPlayers(' %_\\ ')).resolves.toEqual([])
      await expect(discovery.searchPlayers(' team|alpha ')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 90, name: 'Team | Alpha Prime' }),
      ])

      const explain = postgres(connectionString, { max: 1 })
      try {
        await explain`SET enable_seqscan = off`
        const plan = await explain`
          EXPLAIN (FORMAT JSON)
          SELECT term.*
          FROM discovery.player_terms term
          JOIN discovery.player_generations generation
            ON generation.generation_id = term.generation_id AND generation.active
          WHERE term.normalized_term >= 'alpha' COLLATE "C"
            AND term.normalized_term < ${'alpha\u{10ffff}'} COLLATE "C"
        `
        expect(JSON.stringify(plan)).toContain('discovery_player_terms_prefix')
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

      const capped = await discovery.searchPlayers('prefix')
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

      const prefixHits = await discovery.searchPlayers('prefix')
      expect(prefixHits.filter(({ brawlhallaId }) => brawlhallaId === 999)).toHaveLength(1)
      expect(prefixHits.find(({ brawlhallaId }) => brawlhallaId === 999)?.matchedAlias).toBe('Prefix')

      await discovery.rebuildPlayers({ sourceVersion: 4, facts: [fact(777, 'Replacement', null, 0)] })
      await expect(discovery.searchPlayers('prefix')).resolves.toEqual([])
      await expect(discovery.searchPlayers('replacement')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 777, rating: null }),
      ])
    } finally {
      await discovery.close()
    }
  })

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
      await expect(discovery.searchPlayers('newest')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 500, name: 'Newest Name', rating: 2200 }),
      ])
      await expect(
        discovery.rebuildPlayers({ sourceVersion: 9, facts: [fact(500, 'Stale Rebuild', 1700, 0)] }),
      ).rejects.toThrow()
      await expect(discovery.searchPlayers('newest')).resolves.toHaveLength(1)
    } finally {
      await discovery.close()
    }
  })
})
