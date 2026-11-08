import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { clanModule, createPostgresClanDiscoverySource, createPostgresClans } from '@brawltome/clan'
import { createClanDiscoveryProjectionJob, createPostgresDiscovery, discoveryModule } from '@brawltome/discovery'
import { type BrawltomeModule, type Database, migratePostgres, orderMigrations } from '@brawltome/foundation'
import { createTestDatabase, openTestClient, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { type AdmissionConfig, refreshOperationsModule } from '@brawltome/refresh-operations'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'
import { createTestQueue } from './fixtures/queue'

let connectionString = ''
let database: TestDatabase

// starts empty: player migration 0005 adds its triggers only when the legacy public.player tables exist
// before it runs, so they are created before migrating
beforeAll(async () => {
  database = await createTestDatabase({ label: 'discovery_reconcile', modules: [] })
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

  const modules: readonly BrawltomeModule[] = [playerModule, clanModule, refreshOperationsModule, discoveryModule]

  await migratePostgres(connectionString, orderMigrations(modules.flatMap((module) => module.migrations)))
}, 30_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

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

const profile = (name: string, xp: string) => ({
  clanId: 42,
  clanName: name,
  clanCreateDate: new Date('2024-01-01'),
  clanXp: xp,
  clanLifetimeXp: xp,
  notice: '',
  tags: [],
  discordInviteCode: '',
  guildPoints: '0',
  isRecruiting: false,
})

const provenance = { source: 'v1-guild-stats' as const, outcome: 'success' as const }

describe('Clan Discovery delivery and reconciliation', () => {
  test('recovers acknowledgement crashes, replays dead letters against current facts, and repairs zero-lag drift', async () => {
    const clans = createPostgresClans(database)
    const source = createPostgresClanDiscoverySource(database)
    const discovery = createPostgresDiscovery(database)
    const control = postgres(connectionString)
    // the operations worker restarts twice below, so it gets a client of its own to close and reopen
    let operationsClient = openTestClient(connectionString)

    async function restartOperationsClient(): Promise<Database> {
      await operationsClient.close()
      operationsClient = openTestClient(connectionString)

      return operationsClient
    }

    let operations = createTestQueue({ database: operationsClient }, discovery)

    const projectionJobDependencies = {
      projectionEffectState: discovery.clanProjectionEffectState,
      leaseActive: async () => true,
    }

    const projectionOptions = {
      leaseMs: 10_000,
      retryDelayMs: 0,
      admission,
      movedJobs: [
        createClanDiscoveryProjectionJob({
          ...projectionJobDependencies,
          deliverPending: (batchSize, effectOperationId) =>
            discovery.deliverPendingClans(source, batchSize, effectOperationId),
        }),
      ],
    }

    try {
      await clans.publishProfile(profile('Initial Clan', '10'), new Date('2024-01-01'), provenance)

      const failedAck = await operations.accept({
        kind: 'clan-discovery-projection',
        dedupeKey: `clan-projection-failed-ack:${randomUUID()}`,
        operationKey: `clan-projection-failed-ack:${randomUUID()}`,
        workClass: 'projection',
        payload: { batchSize: 100 },
        provenance: { source: 'integration-test', requestedBy: 'issue-200' },
        maxAttempts: 1,
      })

      await runOneRefreshOperation(operations, 'failed-ack-worker', {
        ...projectionOptions,
        movedJobs: [
          createClanDiscoveryProjectionJob({
            ...projectionJobDependencies,
            deliverPending: (batchSize, effectOperationId) =>
              discovery.deliverPendingClans(
                {
                  pendingEvents: source.pendingEvents,
                  acknowledgeEvents: async () => {
                    throw new Error('simulated clan owner acknowledgement failure')
                  },
                  snapshot: source.snapshot,
                  lag: source.lag,
                },
                batchSize,
                effectOperationId,
              ),
          }),
        ],
      })

      expect((await operations.inspect(failedAck.operationId)).operation.status).toBe('pending')
      expect(await source.lag()).toBeGreaterThan(0)

      operations = createTestQueue({ database: await restartOperationsClient() }, discovery)

      await runOneRefreshOperation(operations, 'restarted-worker', projectionOptions)
      expect((await operations.inspect(failedAck.operationId)).operation.status).toBe('succeeded')
      expect(await source.lag()).toBe(0)

      const deadLetter = await operations.accept({
        kind: 'clan-discovery-projection',
        dedupeKey: `clan-projection-dead-letter:${randomUUID()}`,
        operationKey: `clan-projection-dead-letter:${randomUUID()}`,
        workClass: 'projection',
        payload: { batchSize: 100 },
        provenance: { source: 'integration-test', requestedBy: 'issue-200' },
        maxAttempts: 1,
      })

      const deadLease = await operations.claim('dead-letter-worker', 10_000, admission, 'clan-discovery-projection')

      if (deadLease?.kind !== 'clan-discovery-projection') throw new Error('Expected Clan projection lease')

      await operations.fail(deadLease, { code: 'repairable', message: 'repairable', retryable: false }, 0)
      await clans.publishProfile(profile('Current Clan', '900719925474099312345'), new Date('2024-01-02'), provenance)

      const replay = await operations.replayDeadLetter({
        operationId: deadLetter.operationId,
        actorId: 'operator:discovery',
        reason: 'projection dependency repaired',
      })

      if (replay.outcome !== 'replayed') throw new Error('Expected dead-letter replay')

      await runOneRefreshOperation(operations, 'replay-worker', projectionOptions)

      expect(await discovery.search('current')).toEqual({
        players: [],
        clans: [{ clanId: 42, clanName: 'Current Clan', clanXp: '900719925474099312345', memberCount: 0 }],
      })

      await control`
        UPDATE discovery.terms SET canonical_name = 'Corrupt', display_term = 'Corrupt', normalized_term = 'corrupt'
        WHERE entity_kind = 'clan' AND entity_id = 42
      `

      expect(await source.lag()).toBe(0)

      const reconciliation = await operations.accept({
        kind: 'discovery-reconciliation',
        dedupeKey: `clan-reconciliation:${randomUUID()}`,
        operationKey: `clan-reconciliation:${randomUUID()}`,
        workClass: 'projection',
        payload: { owner: 'clan' },
        provenance: { source: 'integration-test', requestedBy: 'issue-200' },
        maxAttempts: 1,
      })

      const reconciliationLease = await operations.claim(
        'crashing-reconciliation-worker',
        10_000,
        admission,
        'discovery-reconciliation',
      )

      if (reconciliationLease?.kind !== 'discovery-reconciliation') {
        throw new Error('Expected reconciliation lease')
      }

      const evidence = await discovery.reconcileClans(source, reconciliationLease.effectOperationId)

      expect(evidence).toMatchObject({ exactBefore: false, exactAfter: true, repaired: true })

      await control`
        UPDATE refresh_operations.operations
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${reconciliationLease.operationId}
      `

      expect(
        await operations.claim('reconciliation-recovery', 10_000, admission, 'discovery-reconciliation'),
      ).toBeNull()

      expect((await operations.inspect(reconciliation.operationId)).operation.status).toBe('succeeded')

      expect(await discovery.search('current')).toEqual({
        players: [],
        clans: [{ clanId: 42, clanName: 'Current Clan', clanXp: '900719925474099312345', memberCount: 0 }],
      })

      let effectStateRead!: () => void

      const effectStateWasRead = new Promise<void>((resolve) => {
        effectStateRead = resolve
      })

      let releaseRecovery!: () => void

      const recoveryMayContinue = new Promise<void>((resolve) => {
        releaseRecovery = resolve
      })

      operations = createTestQueue(
        { database: await restartOperationsClient() },
        {
          projectionEffectState: discovery.projectionEffectState,
          reconciliationEffectApplied: async (effectOperationId) => {
            const applied = await discovery.reconciliationEffectApplied(effectOperationId)

            effectStateRead()
            await recoveryMayContinue

            return applied
          },
        },
      )

      const rejectedLateEffect = await operations.accept({
        kind: 'discovery-reconciliation',
        dedupeKey: `late-reconciliation:${randomUUID()}`,
        operationKey: `late-reconciliation:${randomUUID()}`,
        workClass: 'projection',
        payload: { owner: 'clan' },
        provenance: { source: 'integration-test', requestedBy: 'issue-200' },
        maxAttempts: 1,
      })

      const lateLease = await operations.claim('late-worker', 10_000, admission, 'discovery-reconciliation')

      if (lateLease?.kind !== 'discovery-reconciliation') throw new Error('Expected late lease')

      await control`
        UPDATE refresh_operations.operations
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${lateLease.operationId}
      `

      const recovery = operations.claim('final-attempt-recovery', 10_000, admission, 'discovery-reconciliation')

      await effectStateWasRead

      const lateEffect = discovery.reconcileClans(source, lateLease.effectOperationId, () =>
        operations.discoveryLeaseActive(lateLease),
      )

      const lateEffectOutcome = lateEffect.then(
        () => null,
        (error: unknown) => error,
      )

      releaseRecovery()
      expect(await recovery).toBeNull()
      expect((await operations.inspect(rejectedLateEffect.operationId)).operation.status).toBe('dead_letter')
      expect(String(await lateEffectOutcome)).toContain('Discovery effect lease is no longer active')
      expect(await discovery.reconciliationEffectApplied(lateLease.effectOperationId)).toBe(false)
    } finally {
      await Promise.all([control.end(), operationsClient.close()])
    }
  }, 30_000)
})
