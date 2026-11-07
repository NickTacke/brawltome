import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createPostgresDiscovery, discoveryModule } from '@brawltome/discovery'
import { migratePostgres, orderMigrations } from '@brawltome/foundation'
import { type TestDatabase, createTestDatabase, openTestClient } from '@brawltome/foundation/testing'
import { createPostgresPlayerDiscoverySource, playerModule } from '@brawltome/player'
import {
  type AdmissionConfig,
  createPostgresRefreshOperations,
  refreshOperationsModule,
} from '@brawltome/refresh-operations'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

let connectionString = ''
let database: TestDatabase

// starts empty: player migration 0005 adds its triggers only when the legacy public.player tables exist
// before it runs, so they are created before migrating
beforeAll(async () => {
  database = await createTestDatabase({ label: 'discovery_projection', modules: [] })
  connectionString = database.connectionString
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
  } finally {
    await setup.end()
  }

  const modules = [playerModule, refreshOperationsModule, discoveryModule]

  await migratePostgres(connectionString, orderMigrations(modules.flatMap((module) => module.migrations)))
}, 20_000)

afterAll(async () => {
  await database?.drop()
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
    const source = createPostgresPlayerDiscoverySource(database)
    const discovery = createPostgresDiscovery(database)
    // the operations worker restarts below, so it gets a client of its own to close and reopen
    let operationsClient = openTestClient(connectionString)

    let operations = createPostgresRefreshOperations(
      { database: operationsClient },
      {
        playerProjectionEffectState: discovery.playerProjectionEffectState,
      },
    )

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
        VALUES
          (10, 'former', 'Former', now(), ${archiveChecksum}),
          (13, 'mã¼ller', 'MÃ¼ller', now(), ${archiveChecksum})
      `

      await control`
        INSERT INTO players.ranked_profiles
          (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
        VALUES
          (10, 'Canonical | Player', now(), now(), 'EU', 2100, 2200, 'Platinum', 10, 20),
          (13, 'MÃ¼ller', now(), now(), 'EU', 2100, 2200, 'Platinum', 10, 20)
      `

      await control`
        INSERT INTO players.career_profiles
          (brawlhalla_id, player_name, checked_at, last_success_at, xp, level, xp_percentage,
           games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
           snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
        VALUES
          (10, 'Career | Player', now(), now(), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
          (12, 'Career Only', now(), now(), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
          (13, 'Müller', now(), now(), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
      `

      await enqueueImportedPlayers(control, [10, 11, 12, 13])

      const eager = await source.snapshot()

      expect(eager.facts).toContainEqual(
        expect.objectContaining({
          brawlhallaId: 10,
          name: 'Career | Player',
          aliases: expect.arrayContaining(['Canonical | Player', 'Legacy | Player']),
        }),
      )

      expect(eager.facts).toContainEqual(
        expect.objectContaining({ brawlhallaId: 12, name: 'Career Only', rating: null, bestLegendNameKey: null }),
      )

      expect(eager.facts).toContainEqual(expect.objectContaining({ brawlhallaId: 13, name: 'Müller', aliases: [] }))
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
        expect.objectContaining({ brawlhallaId: 10, name: 'Career | Player', rating: 2100, matchedAlias: 'Former' }),
      ])

      await expect(playerResults(discovery, 'canonical')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 10, name: 'Career | Player', matchedAlias: 'Canonical | Player' }),
      ])

      await expect(playerResults(discovery, 'career only')).resolves.toEqual([
        expect.objectContaining({ brawlhallaId: 12, name: 'Career Only', rating: null }),
      ])

      await expect(playerResults(discovery, 'mã¼ller')).resolves.toEqual([])

      await discovery.rebuildPlayers({
        sourceVersion: eager.sourceVersion,
        facts: eager.facts.map((fact) =>
          fact.brawlhallaId === 10 ? { ...fact, name: 'Canonical | Player', aliases: ['Former'] } : fact,
        ),
      })

      expect((await playerResults(discovery, 'career')).find(({ brawlhallaId }) => brawlhallaId === 10)).toBeUndefined()
      await expect(discovery.reconcilePlayers(source)).resolves.toMatchObject({ repaired: true, exactAfter: true })

      expect((await playerResults(discovery, 'career')).find(({ brawlhallaId }) => brawlhallaId === 10)).toMatchObject({
        brawlhallaId: 10,
        name: 'Career | Player',
      })

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

      await operationsClient.close()
      operationsClient = openTestClient(connectionString)

      operations = createPostgresRefreshOperations(
        { database: operationsClient },
        {
          playerProjectionEffectState: discovery.playerProjectionEffectState,
        },
      )

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
      await Promise.all([control.end(), operationsClient.close()])
    }
  })
})
