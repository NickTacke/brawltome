import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { initializeDiscovery } from '../migrations/0001-initialize-discovery'
import { generalizeDiscovery } from '../migrations/0002-generalize-discovery'
import { createPostgresDiscovery } from '../postgres'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `brawltome_discovery_upgrade_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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
}, 20_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
}, 20_000)

describe('Discovery generalized migration', () => {
  test('preserves active #199 terms, receipts, watermarks, and acknowledgement state', async () => {
    const setup = postgres(connectionString, { max: 1 })
    const eventId = randomUUID()
    const operationId = randomUUID()
    try {
      await setup.unsafe(initializeDiscovery.sql)
      const [generation] = await setup<{ generation_id: string }[]>`
        UPDATE discovery.player_generations SET source_version = 7
        WHERE active RETURNING generation_id
      `
      await setup`
        INSERT INTO discovery.player_terms
          (generation_id, brawlhalla_id, term_kind, display_term, normalized_term,
           canonical_name, region, rating, view_count, best_legend_name_key)
        VALUES
          (${generation.generation_id}, 42, 'canonical', 'Preserved Player', 'preserved player',
           'Preserved Player', 'EU', 2200, 9, 'bodvar')
      `
      await setup`
        INSERT INTO discovery.player_event_receipts (event_id) VALUES (${eventId})
      `
      await setup`
        INSERT INTO discovery.player_projection_effects (operation_id, source_version)
        VALUES (${operationId}, 7)
      `
      await setup.unsafe(generalizeDiscovery.sql)
    } finally {
      await setup.end()
    }

    const discovery = createPostgresDiscovery(connectionString)
    try {
      expect(await discovery.search('preserved')).toEqual({
        players: [
          {
            brawlhallaId: 42,
            name: 'Preserved Player',
            region: 'EU',
            rating: 2200,
            viewCount: 9,
            bestLegendNameKey: 'bodvar',
            matchedAlias: null,
          },
        ],
        clans: [],
      })
      expect(await discovery.playerProjectionEffectState(operationId)).toBe('applied')
      expect(
        await discovery.applyPlayerEvents([
          {
            eventId,
            brawlhallaId: 42,
            sourceVersion: 8,
            fact: {
              brawlhallaId: 42,
              name: 'Should Not Reapply',
              region: null,
              rating: null,
              viewCount: 0,
              bestLegendNameKey: null,
              aliases: [],
            },
          },
        ]),
      ).toEqual({ appliedEvents: 0 })

      await discovery.rebuildClans({
        sourceVersion: 1,
        facts: [{ clanId: 42, clanName: 'Preserved Clan', clanXp: '100', memberCount: 1 }],
      })
      const overlapping = await discovery.search('preserved')
      expect(overlapping.players[0]?.brawlhallaId).toBe(42)
      expect(overlapping.clans[0]?.clanId).toBe(42)
    } finally {
      await discovery.close()
    }
  })
})
