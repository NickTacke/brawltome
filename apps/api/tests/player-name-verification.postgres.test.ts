import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { accountsMigrationInventory, createPostgresAccounts } from '@brawltome/accounts/composition'
import {
  createPostgresPlayerDiscoverySource,
  createPostgresPlayerNameVerifications,
  createPostgresRankedPlayers,
  playerMigrationInventory,
} from '@brawltome/player/composition'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import {
  createPostgresRequestAdmission,
  requestAdmissionMigrationInventory,
} from '@brawltome/request-admission/composition'
import { createTelemetry } from '@brawltome/telemetry'
import postgres from 'postgres'
import {
  createPlayerNameVerificationExecutor,
  createPlayerNameVerificationPlanner,
  readPlayerNameVerificationConfig,
} from '../src/player-name-verification'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_name_verify_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
let admin: ReturnType<typeof postgres>
let control: ReturnType<typeof postgres>
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
  if (!baseUrl) throw new Error('DATABASE_URL is required for name verification PostgreSQL tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  control = postgres(connectionString, { max: 1, onnotice: () => {} })
  for (const migration of [
    ...accountsMigrationInventory,
    ...playerMigrationInventory,
    ...refreshOperationsMigrationInventory,
    ...requestAdmissionMigrationInventory,
  ]) {
    await control.unsafe(migration.sql)
  }
}, 30_000)

afterAll(async () => {
  await control?.end()
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function seed(brawlhallaId: number, v0Name: string, boardName: string) {
  await control`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, ${v0Name}, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', 'EU', 2000, 2100,
      'Diamond', 1, 2)
  `
  await control`
    INSERT INTO players.leaderboard_name_observations (brawlhalla_id, player_name, observed_at)
    VALUES (${brawlhallaId}, ${boardName}, clock_timestamp() - interval '1 minute')
  `
}

const rankedPayload = (brawlhallaId: number, name: string) => ({
  name,
  brawlhalla_id: brawlhallaId,
  rating: 2000,
  peak_rating: 2100,
  tier: 'Diamond',
  wins: 1,
  games: 2,
  region: 'EU',
  global_rank: 10,
  region_rank: 2,
  legends: [],
  '2v2': [],
})

describe('Player name verification through durable operations', () => {
  test('one background V0 ranked call renames confirmed players and keeps cached leaderboard names as aliases', async () => {
    await seed(501, 'Old A', 'New A')
    await seed(502, 'Old B', 'Cached B')
    await seed(503, 'Old C', 'New C')
    const v0Names = new Map([
      [501, 'New A'],
      [502, 'Old B'],
    ])
    const config = readPlayerNameVerificationConfig({})
    const accounts = createPostgresAccounts(connectionString)
    const signedIn = await accounts.accounts.signInWithDiscord({
      providerAccountId: `name-verification-${randomUUID()}`,
      displayName: 'Ada',
      avatarHash: null,
    })
    await accounts.accounts.pinPlayer(signedIn.account.id, 502)
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const operations = createPostgresRefreshOperations(connectionString)
    const verifications = createPostgresPlayerNameVerifications(connectionString)
    const rankedPlayers = createPostgresRankedPlayers(connectionString)
    const discovery = createPostgresPlayerDiscoverySource(connectionString)
    const sourceAdmission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180, 'brawlhalla-v1': 180 },
      sourceBackgroundHeadroom: 30,
    })
    const readSourceUsage = async () => {
      const usage = await sourceAdmission.inspectCurrentUsage()
      return usage.domains.find(({ domain }) => domain === 'brawlhalla-v0') ?? { used: 0, limit: 180 }
    }
    const v0Calls: number[] = []
    try {
      const planner = createPlayerNameVerificationPlanner({
        config,
        readSourceUsage,
        readDemandIds: accounts.demand.readPlayerIds,
        verifications,
        operations,
        telemetry,
      })
      expect(await accounts.demand.readPlayerIds()).toEqual([502])
      expect(await planner.tick()).toBe(3)
      // A profile visit refreshes 503 through the normal ranked path before its verification runs.
      await control`UPDATE players.ranked_profiles SET last_success_at = clock_timestamp() WHERE brawlhalla_id = 503`

      // Interactive work keeps its reserved slot ahead of queued verifications.
      await operations.accept({
        dedupeKey: `interactive:${randomUUID()}`,
        operationKey: `interactive:${randomUUID()}`,
        workClass: 'interactive',
        payload: { value: 'user' },
        provenance: { source: 'test' },
      })
      const first = await operations.claim('probe', 10_000, admission)
      expect(first?.workClass).toBe('interactive')
      if (first) await operations.complete(first)

      const execute = createPlayerNameVerificationExecutor({
        config,
        verifications,
        readSourceUsage,
        rankedPlayers,
        rankedSource: (admitSourceCall) => ({
          getRanked: async (brawlhallaId, options) => {
            await admitSourceCall('brawlhalla-v0')
            options.onAttempt()
            v0Calls.push(brawlhallaId)
            return rankedPayload(brawlhallaId, v0Names.get(brawlhallaId) ?? '')
          },
        }),
        telemetry,
      })
      const run = () =>
        runOneRefreshOperation(operations, 'worker', {
          leaseMs: 10_000,
          retryDelayMs: 1,
          admission,
          sourceAdmission,
          executePlayerNameVerification: execute,
        })
      expect(await run()).toBe(true)
      expect(await run()).toBe(true)
      expect(await run()).toBe(true)
      expect(await run()).toBe(false)

      expect(v0Calls.sort()).toEqual([501, 502])
      expect((await sourceAdmission.inspectUsage()).sourceUnits).toEqual({ 'brawlhalla-v0': 2 })
      const outcomes = await control<{ brawlhalla_id: number; outcome: string }[]>`
        SELECT brawlhalla_id, outcome FROM players.name_verifications ORDER BY brawlhalla_id
      `
      expect([...outcomes]).toEqual([
        { brawlhalla_id: 501, outcome: 'renamed' },
        { brawlhalla_id: 502, outcome: 'confirmed_stale' },
        { brawlhalla_id: 503, outcome: 'confirmed_stale' },
      ])
      const statuses = await control<{ status: string }[]>`
        SELECT status FROM refresh_operations.operations WHERE kind = 'player-name-verification'
      `
      expect(statuses.map(({ status }) => status)).toEqual(['succeeded', 'succeeded', 'succeeded'])

      const facts = new Map((await discovery.snapshot()).facts.map((fact) => [fact.brawlhallaId, fact]))
      expect(facts.get(501)?.name).toBe('New A')
      expect(facts.get(502)).toMatchObject({ name: 'Old B', aliases: ['Cached B'] })
      expect((await rankedPlayers.referenceById(501))?.name).toBe('New A')

      // Settled pairs are neither candidates nor re-checked.
      expect(
        (await verifications.candidates({ dedupeMs: 1, staleRecheckMs: config.staleRecheckMs })).candidates,
      ).toEqual([])
      const outcomeCounts = () => {
        const counter = telemetry.metrics.snapshot().find(({ name }) => name === 'player_name_verifications_total')
        return Object.fromEntries((counter?.series ?? []).map(({ labels, value }) => [labels.outcome, value]))
      }
      expect(outcomeCounts()).toEqual({ renamed: 1, unchanged: 1, resolved_free: 1 })

      // Verification never touches the on-demand reservation: with background V0 admission exhausted, users
      // are still admitted, and verification stops at its usage ratio long before that.
      const admit = (caller: 'on-demand' | 'background') =>
        sourceAdmission.admitSource({ domain: 'brawlhalla-v0', reservationKey: randomUUID(), units: 1, caller })
      while ((await admit('background')).outcome === 'admitted') {}
      expect((await readSourceUsage()).used).toBe(150)
      expect((await admit('on-demand')).outcome).toBe('admitted')
      await seed(504, 'Old D', 'New D')
      const busyPlanner = createPlayerNameVerificationPlanner({
        config,
        readSourceUsage,
        verifications,
        operations,
        telemetry,
      })
      expect(await busyPlanner.tick()).toBe(0)
      expect(outcomeCounts().skipped_budget).toBe(1)
    } finally {
      await Promise.all([
        operations.close(),
        verifications.close(),
        rankedPlayers.close(),
        discovery.close(),
        sourceAdmission.close(),
        accounts.close(),
      ])
    }
  })
})
