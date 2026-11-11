import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createPostgresDiscovery, discoveryModule } from '@brawltome/discovery'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  createPlayerNameVerificationJob,
  createPlayerRefreshReservations,
  createPostgresPlayerDiscoverySource,
  createPostgresPlayerNameVerifications,
  createPostgresRankedPlayers,
  playerModule,
  refreshCanonicalRankedPlayer,
} from '@brawltome/player'
import { type PostgresRefreshOperations, queueModule } from '@brawltome/queue'
import { createPostgresRequestAdmission, requestAdmissionModule } from '@brawltome/request-admission'
import postgres from 'postgres'
import {
  createPlayerNameVerificationExecutor,
  createPlayerNameVerificationPlanner,
  readPlayerNameVerificationConfig,
} from '../src/player-name-verification'
import { createTestQueue, runOneWithJobs } from './fixtures/queue'

let database: TestDatabase
let control: ReturnType<typeof postgres>

const visitedId = 600
const teammateId = 601

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
  database = await createTestDatabase({
    label: 'teammate_name_signals',
    modules: [queueModule, requestAdmissionModule, playerModule, discoveryModule],
  })

  control = postgres(database.connectionString, { max: 1, onnotice: () => {} })
}, 30_000)

afterAll(async () => {
  await control?.end()
  await database?.drop()
})

const rankedPayload = (brawlhallaId: number, name: string, teams: unknown[] = []) => ({
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
  '2v2': teams,
})

const teamWith = (brawlhallaIdTwo: number, teamname: string) => ({
  brawlhalla_id_one: visitedId,
  brawlhalla_id_two: brawlhallaIdTwo,
  rating: 1900,
  peak_rating: 1950,
  tier: 'Platinum 3',
  wins: 5,
  games: 9,
  teamname,
  region: 3,
  global_rank: 0,
})

// a visitor opens a profile: the same fenced V0 ranked refresh the interactive job runs
async function visit(operations: PostgresRefreshOperations, payload: ReturnType<typeof rankedPayload>) {
  const refreshes = createPlayerRefreshReservations(database)

  const reserved = await refreshes.reserveInteractivePlayerRefresh({
    dedupeKey: `visit:${randomUUID()}`,
    operationKey: `visit:${randomUUID()}`,
    brawlhallaId: payload.brawlhalla_id,
    staleSections: ['ranked'],
    provenance: { source: 'integration-test' },
    reservationTtlSeconds: 30,
  })

  if (reserved.outcome !== 'reserved') throw new Error('Expected a reserved refresh')

  await refreshes.activateInteractivePlayerRefresh(reserved.operationId, reserved.reservationToken)
  const lease = await operations.claim('visit-worker', 10_000, admission, 'interactive-player-refresh')

  if (lease?.kind !== 'interactive-player-refresh') throw new Error('Expected an interactive lease')

  await operations.beginInteractiveSection(lease, 'ranked')

  const source = {
    getRanked: async (_brawlhallaId: number, options: { onAttempt(): void }) => {
      options.onAttempt()

      return payload
    },
  }

  await refreshCanonicalRankedPlayer(
    createPostgresRankedPlayers(database),
    source,
    payload.brawlhalla_id,
    { caller: 'on-demand' },
    {
      operationId: lease.operationId,
      effectOperationId: lease.effectOperationId,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      effectCreatedAt: lease.effectCreatedAt,
      section: 'ranked',
    },
  )

  await operations.commitInteractiveSection(lease, 'ranked')
  await operations.complete(lease)
}

describe('A teammate renamed since their last refresh', () => {
  test('is found by the new name after a visit to their teammate and one name check', async () => {
    const operations = createTestQueue({ database })
    const verifications = createPostgresPlayerNameVerifications(database)
    const discoverySource = createPostgresPlayerDiscoverySource(database)
    const discovery = createPostgresDiscovery(database)
    const config = readPlayerNameVerificationConfig({})
    const names = async (query: string) => (await discovery.search(query)).players.map(({ name }) => name)

    await control`
      INSERT INTO players.ranked_profiles
        (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
      VALUES (${teammateId}, 'Kettle Drum', now() - interval '19 days', now() - interval '19 days', 'EU', 2000,
        2100, 'Diamond', 1, 2)
    `

    await discovery.deliverPendingPlayers(discoverySource, 100)

    expect(await names('kettle drum')).toEqual(['Kettle Drum'])
    expect(await names('teacup')).toEqual([])

    const visitedPayload = rankedPayload(visitedId, 'Saucer', [
      teamWith(teammateId, 'Saucer+Teacup'),
      teamWith(602, 'Saucer+Stranger'),
      teamWith(603, 'Saucer+Plus+Sign'),
    ])

    await visit(operations, visitedPayload)

    const signals = async () => [
      ...(await control<{ brawlhalla_id: number; player_name: string; profile_brawlhalla_id: number }[]>`
        SELECT brawlhalla_id, player_name, profile_brawlhalla_id FROM players.teammate_name_signals
      `),
    ]

    // the team name is a hint: nothing is renamed and nothing new is searchable yet
    expect(await signals()).toEqual([
      { brawlhalla_id: teammateId, player_name: 'Teacup', profile_brawlhalla_id: visitedId },
    ])

    await discovery.deliverPendingPlayers(discoverySource, 100)
    expect(await names('teacup')).toEqual([])
    expect(await names('kettle drum')).toEqual(['Kettle Drum'])

    // a second visit with the same teams keeps the one signal, and later the one check
    await visit(operations, visitedPayload)

    expect(await signals()).toEqual([
      { brawlhalla_id: teammateId, player_name: 'Teacup', profile_brawlhalla_id: visitedId },
    ])

    const sourceAdmission = createPostgresRequestAdmission(database, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180, 'brawlhalla-v1': 180 },
      sourceBackgroundHeadroom: 30,
    })

    const readSourceUsage = async () => {
      const usage = await sourceAdmission.inspectCurrentUsage()

      return usage.domains.find(({ domain }) => domain === 'brawlhalla-v0') ?? { used: 0, limit: 180 }
    }

    const planner = createPlayerNameVerificationPlanner({ config, readSourceUsage, verifications, operations })

    expect(await planner.tick()).toBe(1)

    const v0Calls: number[] = []

    const verifyName = createPlayerNameVerificationExecutor({
      config,
      verifications,
      readSourceUsage,
      rankedPlayers: createPostgresRankedPlayers(database),
      rankedSource: (admitSourceCall) => ({
        getRanked: async (brawlhallaId, options) => {
          await admitSourceCall('brawlhalla-v0')
          options.onAttempt()
          v0Calls.push(brawlhallaId)

          return rankedPayload(brawlhallaId, 'Teacup')
        },
      }),
    })

    const ran = await runOneWithJobs(operations, 'worker', {
      leaseMs: 10_000,
      retryDelayMs: 1,
      admission,
      sourceAdmission,
      jobs: [createPlayerNameVerificationJob({ verifyName })],
    })

    expect(ran).toBe(true)
    expect(v0Calls).toEqual([teammateId])

    expect([...(await control`SELECT brawlhalla_id, player_name, outcome FROM players.name_verifications`)]).toEqual([
      { brawlhalla_id: teammateId, player_name: 'Teacup', outcome: 'renamed' },
    ])

    await discovery.deliverPendingPlayers(discoverySource, 100)

    expect((await discovery.search('teacup')).players).toEqual([
      expect.objectContaining({ brawlhallaId: teammateId, name: 'Teacup', matchedAlias: null }),
    ])

    expect((await discovery.search('kettle drum')).players).toEqual([
      expect.objectContaining({ brawlhallaId: teammateId, name: 'Teacup', matchedAlias: 'Kettle Drum' }),
    ])

    expect((await verifications.candidates({ dedupeMs: 1, staleRecheckMs: config.staleRecheckMs })).candidates).toEqual(
      [],
    )
  })
})
