import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createPostgresDiscovery, discoveryMigrationInventory } from '@brawltome/discovery/composition'
import { createPostgresPlayerDiscoverySource, playerMigrationInventory } from '@brawltome/player/composition'
import type { AdmissionConfig } from '@brawltome/refresh-operations'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `bt_projection_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
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
    await setup.unsafe(`
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
    `)
    for (const migration of [
      ...playerMigrationInventory,
      ...refreshOperationsMigrationInventory,
      ...discoveryMigrationInventory,
    ]) {
      await setup.unsafe(migration.sql)
    }
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

async function enqueueImportedPlayers(client: ReturnType<typeof postgres>, brawlhallaIds: number[]): Promise<void> {
  const [state] = await client<{ source_version: string }[]>`
    UPDATE players.discovery_state SET source_version = source_version + 1
    WHERE singleton RETURNING source_version
  `
  await client`
    INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
    SELECT identity, ${state.source_version}::bigint FROM unnest(${brawlhallaIds}::integer[]) AS identity
  `
}

const admission: AdmissionConfig = {
  totalConcurrency: 2,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 1,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
}

describe('Players to Discovery projection delivery', () => {
  test('shows durable lag, replays idempotently, and rebuilds from an owner snapshot', async () => {
    const control = postgres(connectionString)
    const source = createPostgresPlayerDiscoverySource(connectionString)
    const discovery = createPostgresDiscovery(connectionString)
    let operations = createPostgresRefreshOperations(connectionString, {
      playerProjectionEffectState: discovery.playerProjectionEffectState,
    })
    try {
      const archiveChecksum = 'a'.repeat(64)
      await control`
        INSERT INTO players.legacy_discovery_profiles
          (brawlhalla_id, player_name, region, rating, view_count, observed_at, archive_checksum)
        VALUES
          (10, 'Legacy | Player', 'US-E', 1700, 9, now(), ${archiveChecksum}),
          (11, 'Legacy Zero', 'US-W', NULL, 0, now(), ${archiveChecksum})
      `
      await control`
        INSERT INTO players.legacy_discovery_aliases
          (brawlhalla_id, normalized_alias, display_alias, observed_at, archive_checksum)
        VALUES (10, 'former', 'Former', now(), ${archiveChecksum})
      `
      await enqueueImportedPlayers(control, [10, 11])
      await control`
        INSERT INTO players.ranked_profiles
          (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
        VALUES (10, 'Canonical | Player', now(), now(), 'EU', 2100, 2200, 'Platinum', 10, 20)
      `

      const eager = await source.snapshot()
      if (!source.withSnapshot) throw new Error('Expected streaming Player snapshot')
      const streamed = await source.withSnapshot(async (snapshot) => {
        const read = async () => {
          const facts = []
          for await (const fact of snapshot.facts()) facts.push(fact)
          return facts
        }
        return {
          sourceVersion: snapshot.sourceVersion,
          pendingEventCount: snapshot.pendingEventCount,
          oldestPendingAt: snapshot.oldestPendingAt,
          first: await read(),
          second: await read(),
        }
      })
      expect(streamed).toEqual({
        sourceVersion: eager.sourceVersion,
        pendingEventCount: eager.pendingEventCount,
        oldestPendingAt: eager.oldestPendingAt,
        first: eager.facts,
        second: eager.facts,
      })

      expect(await source.lag()).toBeGreaterThan(0)
      await expect(playerResults(discovery, 'player')).resolves.toEqual([])

      const operationInput = {
        kind: 'player-discovery-projection' as const,
        dedupeKey: 'discovery:players:pending',
        operationKey: `discovery:players:${randomUUID()}`,
        workClass: 'projection' as const,
        payload: { batchSize: 100 },
        provenance: { source: 'projection-reconciliation', requestedBy: 'issue-199' },
      }
      const accepted = await Promise.all([operations.accept(operationInput), operations.accept(operationInput)])
      expect(new Set(accepted.map(({ operationId }) => operationId)).size).toBe(1)

      let firstDelivery: { appliedEvents: number; eventIds: string[] } | undefined
      expect(
        await runOneRefreshOperation(operations, 'projection-worker', {
          leaseMs: 10_000,
          retryDelayMs: 10,
          admission,
          executePlayerProjection: async (lease) => {
            firstDelivery = await discovery.deliverPendingPlayers(source, lease.payload.batchSize, lease.operationId)
          },
        }),
      ).toBe(true)
      if (!firstDelivery) throw new Error('Projection operation did not execute')
      expect(firstDelivery.appliedEvents).toBeGreaterThan(0)
      expect((await operations.inspect(accepted[0].operationId)).operation.status).toBe('succeeded')
      expect(await source.lag()).toBe(0)
      await expect(playerResults(discovery, 'former')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 10, name: 'Canonical | Player', rating: 2100, matchedAlias: 'Former' }),
      ])
      await expect(playerResults(discovery, 'legacy')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 11, rating: null, viewCount: 0, matchedAlias: null }),
        expect.objectContaining({ brawlhallaId: 10, matchedAlias: 'Legacy | Player' }),
      ])

      await source.replayDeliveredEvents(firstDelivery.eventIds)
      await expect(discovery.deliverPendingPlayers(source, 100)).resolves.toMatchObject({ appliedEvents: 0 })
      expect(await source.lag()).toBe(0)

      await control`UPDATE players.legacy_discovery_profiles SET view_count = 99 WHERE brawlhalla_id = 10`
      await enqueueImportedPlayers(control, [10])
      expect(await source.lag()).toBe(1)
      await discovery.rebuildPlayersFrom(source)
      await expect(playerResults(discovery, 'canonical')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 10, viewCount: 99 }),
      ])
      expect(await source.lag()).toBe(1)
      await discovery.deliverPendingPlayers(source, 100)
      expect(await source.lag()).toBe(0)

      await control`UPDATE players.legacy_discovery_profiles SET view_count = 100 WHERE brawlhalla_id = 10`
      await enqueueImportedPlayers(control, [10])
      const finalAttempt = await operations.accept({
        ...operationInput,
        dedupeKey: `discovery:players:final-attempt:${randomUUID()}`,
        operationKey: `discovery:players:final-attempt:${randomUUID()}`,
        maxAttempts: 1,
      })
      const lease = await operations.claim(
        'crashing-projection-worker',
        10_000,
        admission,
        'player-discovery-projection',
      )
      if (!lease || lease.kind !== 'player-discovery-projection') throw new Error('Expected a projection lease')
      await discovery.deliverPendingPlayers(source, lease.payload.batchSize, lease.operationId)
      await control`
        UPDATE refresh_operations.operations
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${lease.operationId}
      `
      expect(await operations.claim('recovery-worker', 10_000, admission, 'player-discovery-projection')).toBeNull()
      expect((await operations.inspect(finalAttempt.operationId)).operation.status).toBe('succeeded')

      await control`UPDATE players.legacy_discovery_profiles SET view_count = 101 WHERE brawlhalla_id = 10`
      await enqueueImportedPlayers(control, [10])
      const failedAcknowledgment = await operations.accept({
        ...operationInput,
        dedupeKey: `discovery:players:failed-ack:${randomUUID()}`,
        operationKey: `discovery:players:failed-ack:${randomUUID()}`,
        maxAttempts: 1,
      })
      const acknowledgmentFailure = new Error('simulated owner acknowledgment failure')
      expect(
        await runOneRefreshOperation(operations, 'failed-ack-worker', {
          leaseMs: 10_000,
          retryDelayMs: 0,
          admission,
          executePlayerProjection: async (claimed) => {
            await discovery.deliverPendingPlayers(
              {
                pendingEvents: source.pendingEvents,
                acknowledgeEvents: async () => {
                  throw acknowledgmentFailure
                },
                snapshot: source.snapshot,
                lag: source.lag,
              },
              claimed.payload.batchSize,
              claimed.operationId,
            )
          },
          playerProjectionEffectState: discovery.playerProjectionEffectState,
        }),
      ).toBe(true)
      expect((await operations.inspect(failedAcknowledgment.operationId)).operation.status).toBe('pending')
      expect(await source.lag()).toBe(1)

      await operations.close()
      operations = createPostgresRefreshOperations(connectionString, {
        playerProjectionEffectState: discovery.playerProjectionEffectState,
      })
      expect(
        await runOneRefreshOperation(operations, 'restarted-projection-worker', {
          leaseMs: 10_000,
          retryDelayMs: 0,
          admission,
          executePlayerProjection: async (claimed) => {
            await discovery.deliverPendingPlayers(source, claimed.payload.batchSize, claimed.operationId)
          },
          playerProjectionEffectState: discovery.playerProjectionEffectState,
        }),
      ).toBe(true)
      expect((await operations.inspect(failedAcknowledgment.operationId)).operation.status).toBe('succeeded')
      expect(await source.lag()).toBe(0)
    } finally {
      await Promise.all([control.end(), source.close(), discovery.close(), operations.close()])
    }
  })
})
