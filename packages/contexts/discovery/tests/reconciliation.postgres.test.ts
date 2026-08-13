import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { PlayerProjectionSnapshot, PlayerProjectionSource } from '@brawltome/discovery'
import { createPostgresDiscovery, discoveryMigrationInventory } from '@brawltome/discovery/composition'
import postgres from 'postgres'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `brawltome_reconciliation_${process.pid}_${randomUUID().replaceAll('-', '')}`
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
}, 20_000)

const fact = (brawlhallaId: number, name: string, aliases: string[] = []) => ({
  brawlhallaId,
  name,
  region: 'EU',
  rating: 2100,
  viewCount: 9,
  bestLegendNameKey: null,
  aliases,
})

function source(snapshot: PlayerProjectionSnapshot): PlayerProjectionSource {
  return {
    pendingEvents: async () => [],
    acknowledgeEvents: async () => {},
    snapshot: async () => snapshot,
    lag: async () => snapshot.pendingEventCount ?? 0,
  }
}

describe('Discovery owner reconciliation', () => {
  test('detects zero-lag drift, repairs exactly, removes stale identities, and records deterministic evidence', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    const control = postgres(connectionString)
    try {
      expect(await discovery.reconciliationDue('player', 60 * 60 * 1000)).toBe(true)
      await discovery.rebuildPlayers({ sourceVersion: 3, facts: [fact(1, 'Stale'), fact(2, 'Unexpected')] })
      const ownerSnapshot = {
        sourceVersion: 3,
        pendingEventCount: 0,
        oldestPendingAt: null,
        facts: [fact(1, 'Current', ['Former', '\u{10000}', '\u{e000}'])],
      }

      const repaired = await discovery.reconcilePlayers(source(ownerSnapshot), randomUUID())
      expect(repaired).toMatchObject({
        owner: 'player',
        observedSourceVersion: 3,
        pendingEventCount: 0,
        exactBefore: false,
        exactAfter: true,
        repaired: true,
      })
      expect(repaired.differences).toEqual([
        { entityId: 1, kind: 'mismatched' },
        { entityId: 2, kind: 'unexpected' },
      ])
      expect(repaired.projectedHashAfter).toBe(repaired.expectedHash)
      expect(await discovery.search('current')).toEqual({
        players: [expect.objectContaining({ brawlhallaId: 1, name: 'Current' })],
        clans: [],
      })
      expect((await discovery.search('unexpected')).players).toEqual([])

      const clean = await discovery.reconcilePlayers(
        source({ ...ownerSnapshot, facts: [...ownerSnapshot.facts].reverse() }),
      )
      expect(clean).toMatchObject({ exactBefore: true, exactAfter: true, repaired: false, differences: [] })
      expect(clean.expectedHash).toBe(repaired.expectedHash)
      expect(await discovery.reconciliationDue('player', 60 * 60 * 1000)).toBe(false)

      const concurrentOperationId = randomUUID()
      const concurrent = await Promise.all([
        discovery.reconcilePlayers(source(ownerSnapshot), concurrentOperationId),
        discovery.reconcilePlayers(source(ownerSnapshot), concurrentOperationId),
      ])
      expect(concurrent[0].runId).toBe(concurrent[1].runId)

      let mutationError: unknown
      try {
        await control`UPDATE discovery.reconciliation_runs SET repaired = false WHERE run_id = ${repaired.runId}`
      } catch (error) {
        mutationError = error
      }
      expect(String(mutationError)).toContain('discovery reconciliation evidence is immutable')
    } finally {
      await Promise.all([discovery.close(), control.end()])
    }
  })
  test('reconciles a replayable Player fact stream without materializing the legacy snapshot', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    try {
      await discovery.rebuildPlayers({ sourceVersion: 7, facts: [fact(1, 'Stale'), fact(2, 'Unexpected')] })
      const facts = [fact(1, 'Current', ['Former'])]
      const streamedSource: PlayerProjectionSource = {
        pendingEvents: async () => [],
        acknowledgeEvents: async () => {},
        snapshot: async () => {
          throw new Error('legacy snapshot must not be materialized')
        },
        withSnapshot: async (consume) =>
          consume({
            sourceVersion: 7,
            pendingEventCount: 0,
            oldestPendingAt: null,
            facts: async function* () {
              for (const player of facts) yield player
            },
          }),
        lag: async () => 0,
      }

      const repaired = await discovery.reconcilePlayers(streamedSource, randomUUID())
      expect(repaired).toMatchObject({
        owner: 'player',
        exactBefore: false,
        exactAfter: true,
        repaired: true,
        differences: [
          { entityId: 1, kind: 'mismatched' },
          { entityId: 2, kind: 'unexpected' },
        ],
      })
      expect(repaired.projectedHashAfter).toBe(repaired.expectedHash)
    } finally {
      await discovery.close()
    }
  })
})
