import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { accountsMigrationInventory, createPostgresAccounts } from '@brawltome/accounts/composition'
import {
  createPostgresCareerPlayers,
  createPostgresRankedPlayers,
  playerMigrationInventory,
  refreshCanonicalCareerPlayer,
  refreshCanonicalRankedPlayer,
} from '@brawltome/player/composition'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import {
  createPostgresRequestAdmission,
  requestAdmissionMigrationInventory,
} from '@brawltome/request-admission/composition'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `bt_primary_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

const admission = {
  totalConcurrency: 4,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 2,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
} as const

beforeAll(async () => {
  if (!configuredServer?.startsWith(dedicatedServer)) {
    throw new Error('Primary monitoring PostgreSQL tests require dedicated 127.0.0.1:55436')
  }
  const adminUrl = new URL(configuredServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(configuredServer)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of [
      ...accountsMigrationInventory,
      ...playerMigrationInventory,
      ...refreshOperationsMigrationInventory,
      ...requestAdmissionMigrationInventory,
    ]) {
      await setup.unsafe(migration.sql)
    }
  } finally {
    await setup.end()
  }
})

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

const rankedSnapshot = (brawlhallaId: number) => ({
  name: 'Primary Ada',
  brawlhalla_id: brawlhallaId,
  rating: 1700,
  peak_rating: 1750,
  tier: 'Platinum 1',
  wins: 20,
  games: 40,
  region: 'US-E',
  global_rank: 100,
  region_rank: 20,
  legends: [],
  '2v2': [],
})

const careerSnapshot = (brawlhallaId: number) => ({
  brawlhalla_id: brawlhallaId,
  name: 'Primary Ada',
  xp: 100,
  level: 2,
  xp_percentage: 0.5,
  games: 40,
  wins: 20,
  damagebomb: '0',
  damagemine: '0',
  damagespikeball: '0',
  damagesidekick: '0',
  hitsnowball: 0,
  kobomb: 0,
  komine: 0,
  kospikeball: 0,
  kosidekick: 0,
  kosnowball: 0,
  legends: [],
})

describe('Primary Player monitoring', () => {
  test('refreshes only verified ownership through one replica-safe full scheduled operation', async () => {
    const accounts = createPostgresAccounts(connectionString)
    const signedIn = await accounts.accounts.signInWithDiscord({
      providerAccountId: `primary-monitoring-${randomUUID()}`,
      displayName: 'Ada',
      avatarHash: null,
    })
    const attempt = await accounts.accounts.beginPrimaryPlayerVerification({
      accountId: signedIn.account.id,
      steamId: '76561198000000000',
      idempotencyKey: randomUUID(),
    })
    const brawlhallaId = 919208
    await accounts.accounts.resolvePrimaryPlayerVerification(attempt.id, {
      resolve: async () => ({
        brawlhallaId,
        name: 'Primary Ada',
        checkedAt: new Date(),
        source: 'brawlhalla-v0-steam-search',
      }),
    })

    const operationsA = createPostgresRefreshOperations(connectionString)
    const operationsB = createPostgresRefreshOperations(connectionString)
    const snapshot = await accounts.primaryMonitoring.readSnapshot()
    const reconciled = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? operationsA : operationsB).reconcilePrimaryMonitoring(snapshot),
      ),
    )
    expect(reconciled.reduce((sum, result) => sum + result.created, 0)).toBe(1)

    const control = postgres(connectionString, { max: 1 })
    await control`
      UPDATE refresh_operations.schedules
      SET next_due_at = clock_timestamp() - interval '2 seconds',
          first_due_at = clock_timestamp() - interval '2 seconds'
      WHERE resource_key = ${`player:${brawlhallaId}`} AND enabled
    `
    const materialized = await Promise.all(
      Array.from({ length: 12 }, (_, index) => (index % 2 ? operationsA : operationsB).materializeDueSchedules(1)),
    )
    expect(materialized.reduce((sum, result) => sum + result.occurrencesCreated, 0)).toBe(1)

    const sourceAdmission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180, 'brawlhalla-v1': 180 },
    })
    const rankedPlayers = createPostgresRankedPlayers(connectionString)
    const careerPlayers = createPostgresCareerPlayers(connectionString)
    let rankedCalls = 0
    let careerCalls = 0
    const run = (operations: typeof operationsA, workerId: string) =>
      runOneRefreshOperation(operations, workerId, {
        leaseMs: 10_000,
        retryDelayMs: 1,
        admission,
        sourceAdmission,
        isPrimaryMonitoringTarget: async (lease) => {
          const current = await accounts.primaryMonitoring.readSnapshot()
          return current.targets.some(
            (target) =>
              target.assignmentId === lease.payload.assignmentId && target.brawlhallaId === lease.payload.brawlhallaId,
          )
        },
        executeSection: async (lease, section, admitSourceCall, caller) => {
          expect(caller).toBe('background')
          await admitSourceCall('brawlhalla-v0')
          const effect = {
            operationId: lease.operationId,
            effectOperationId: lease.effectOperationId,
            effectCreatedAt: lease.effectCreatedAt,
            leaseOwner: lease.leaseOwner,
            leaseToken: lease.leaseToken,
          }
          if (section === 'ranked') {
            await refreshCanonicalRankedPlayer(
              rankedPlayers,
              {
                getRanked: async (_id, options) => {
                  options.onAttempt()
                  rankedCalls++
                  return rankedSnapshot(brawlhallaId)
                },
              },
              brawlhallaId,
              { caller },
              { ...effect, section: 'ranked' },
            )
          } else {
            await refreshCanonicalCareerPlayer(
              careerPlayers,
              {
                getStats: async (_id, options) => {
                  options.onAttempt()
                  careerCalls++
                  return careerSnapshot(brawlhallaId)
                },
              },
              brawlhallaId,
              { caller },
              { ...effect, section: 'stats' },
              () => null,
            )
          }
        },
      })

    const executions = await Promise.all([run(operationsA, 'replica-a'), run(operationsB, 'replica-b')])
    expect(executions.filter(Boolean)).toHaveLength(1)
    expect({ rankedCalls, careerCalls }).toEqual({ rankedCalls: 1, careerCalls: 1 })
    expect((await sourceAdmission.inspectUsage()).sourceUnits).toEqual({ 'brawlhalla-v0': 2 })
    const rankedProfile = await rankedPlayers.byId(brawlhallaId)
    const careerProfile = await careerPlayers.byId(brawlhallaId)
    expect(rankedProfile?.snapshot?.oneVsOne.rating).toBe(1700)
    expect(careerProfile?.snapshot?.account.level).toBe(2)

    await control`DELETE FROM accounts.primary_players WHERE account_id = ${signedIn.account.id}`
    const afterRemoval = await accounts.primaryMonitoring.readSnapshot()
    expect(afterRemoval.targets).toEqual([])
    expect(await operationsA.reconcilePrimaryMonitoring(afterRemoval)).toEqual({ created: 0, retired: 1 })

    const replacementAttempt = await accounts.accounts.beginPrimaryPlayerVerification({
      accountId: signedIn.account.id,
      steamId: '76561198000000001',
      idempotencyKey: randomUUID(),
    })
    await accounts.accounts.resolvePrimaryPlayerVerification(replacementAttempt.id, {
      resolve: async () => ({
        brawlhallaId: brawlhallaId + 1,
        name: 'Primary Grace',
        checkedAt: new Date(),
        source: 'brawlhalla-v0-steam-search',
      }),
    })
    const afterReassignment = await accounts.primaryMonitoring.readSnapshot()
    expect(afterReassignment.targets.map(({ brawlhallaId: id }) => id)).toEqual([brawlhallaId + 1])
    expect(await operationsB.reconcilePrimaryMonitoring(afterReassignment)).toEqual({ created: 1, retired: 0 })
    await control`DELETE FROM accounts.primary_players WHERE account_id = ${signedIn.account.id}`
    expect(await operationsA.reconcilePrimaryMonitoring(await accounts.primaryMonitoring.readSnapshot())).toEqual({
      created: 0,
      retired: 1,
    })

    await Promise.all([
      control.end(),
      careerPlayers.close(),
      rankedPlayers.close(),
      sourceAdmission.close(),
      operationsA.close(),
      operationsB.close(),
      accounts.close(),
    ])

    const restarted = createPostgresRefreshOperations(connectionString)
    const restartedControl = postgres(connectionString, { max: 1 })
    const [enabled] = await restartedControl`
      SELECT count(*)::int AS count
      FROM refresh_operations.schedules
      WHERE enabled AND provenance ->> 'source' = 'primary-player-monitoring'
    `
    expect(enabled.count).toBe(0)
    await Promise.all([restartedControl.end(), restarted.close()])
  })
})
