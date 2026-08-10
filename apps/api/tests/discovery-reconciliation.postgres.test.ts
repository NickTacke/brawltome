import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  clanMigrationInventory,
  createPostgresClanDiscoverySource,
  createPostgresClans,
} from '@brawltome/clan/composition'
import { createPostgresDiscovery, discoveryMigrationInventory } from '@brawltome/discovery/composition'
import { playerMigrationInventory } from '@brawltome/player/composition'
import type { AdmissionConfig } from '@brawltome/refresh-operations'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `bt_discovery_reconcile_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
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
      ...clanMigrationInventory,
      ...refreshOperationsMigrationInventory,
      ...discoveryMigrationInventory,
    ]) {
      await setup.unsafe(migration.sql)
    }
  } finally {
    await setup.end()
  }
}, 30_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
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
    const clans = createPostgresClans(connectionString)
    const source = createPostgresClanDiscoverySource(connectionString)
    const discovery = createPostgresDiscovery(connectionString)
    const control = postgres(connectionString)
    let operations = createPostgresRefreshOperations(connectionString, {
      projectionEffectState: (kind, effectOperationId) =>
        kind === 'player-discovery-projection'
          ? discovery.playerProjectionEffectState(effectOperationId)
          : discovery.clanProjectionEffectState(effectOperationId),
      reconciliationEffectApplied: discovery.reconciliationEffectApplied,
    })
    const projectionOptions = {
      leaseMs: 10_000,
      retryDelayMs: 0,
      admission,
      executeClanProjection: async (lease: { payload: { batchSize: number }; effectOperationId: string }) => {
        await discovery.deliverPendingClans(source, lease.payload.batchSize, lease.effectOperationId)
      },
      projectionEffectState: (kind: 'player-discovery-projection' | 'clan-discovery-projection', effectId: string) =>
        kind === 'player-discovery-projection'
          ? discovery.playerProjectionEffectState(effectId)
          : discovery.clanProjectionEffectState(effectId),
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
        executeClanProjection: async (lease) => {
          await discovery.deliverPendingClans(
            {
              pendingEvents: source.pendingEvents,
              acknowledgeEvents: async () => {
                throw new Error('simulated clan owner acknowledgement failure')
              },
              snapshot: source.snapshot,
              lag: source.lag,
            },
            lease.payload.batchSize,
            lease.effectOperationId,
          )
        },
      })
      expect((await operations.inspect(failedAck.operationId)).operation.status).toBe('pending')
      expect(await source.lag()).toBeGreaterThan(0)

      await operations.close()
      operations = createPostgresRefreshOperations(connectionString, {
        projectionEffectState: (kind, effectOperationId) =>
          kind === 'player-discovery-projection'
            ? discovery.playerProjectionEffectState(effectOperationId)
            : discovery.clanProjectionEffectState(effectOperationId),
        reconciliationEffectApplied: discovery.reconciliationEffectApplied,
      })
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
      if (!deadLease || deadLease.kind !== 'clan-discovery-projection')
        throw new Error('Expected Clan projection lease')
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
      if (!reconciliationLease || reconciliationLease.kind !== 'discovery-reconciliation') {
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

      await operations.close()
      let effectStateRead!: () => void
      const effectStateWasRead = new Promise<void>((resolve) => {
        effectStateRead = resolve
      })
      let releaseRecovery!: () => void
      const recoveryMayContinue = new Promise<void>((resolve) => {
        releaseRecovery = resolve
      })
      operations = createPostgresRefreshOperations(connectionString, {
        reconciliationEffectApplied: async (effectOperationId) => {
          const applied = await discovery.reconciliationEffectApplied(effectOperationId)
          effectStateRead()
          await recoveryMayContinue
          return applied
        },
      })
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
      if (!lateLease || lateLease.kind !== 'discovery-reconciliation') throw new Error('Expected late lease')
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
      await Promise.all([clans.close(), source.close(), discovery.close(), control.end(), operations.close()])
    }
  }, 30_000)
})
