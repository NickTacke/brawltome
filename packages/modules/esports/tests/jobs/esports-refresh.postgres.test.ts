import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule, SourceAdmissionLimitedError } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { readStoredEsports } from '../../db/read-stored-esports'
import { saveEventSets } from '../../db/save-event-sets'
import { saveRefresh } from '../../db/save-refresh'
import { esportsModule } from '../../index'
import { esportsRefreshContract } from '../../jobs/esports-refresh-contract'
import { createEsportsRefreshJob } from '../../jobs/esports-refresh-job'
import { BrawltoolsHttpError, BrawltoolsNetworkError, BrawltoolsRateLimitError } from '../../source/brawltools-client'
import { match, placement, powerRanking } from '../domain/builders'
import {
  answers,
  type BrawltoolsAnswers,
  createQueue,
  createSourceAdmission,
  enqueue,
  rawPlacement,
  readOperation,
  stubClient,
} from './job-harness'

const brawlhallaId = 4242
const player = { playerId: 77, name: 'Ember', brawlhallaId }
const dayMs = 24 * 60 * 60 * 1000

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'esports_refresh', modules: [queueModule, playerModule, esportsModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

beforeEach(async () => {
  await database.sql`TRUNCATE esports.players, esports.placements, esports.event_sets`
  await database.sql`DELETE FROM queue.attempts`
  await database.sql`DELETE FROM queue.operations`
})

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * dayMs)
}

async function runRefresh(stub: BrawltoolsAnswers) {
  const calls: string[] = []
  const backfills: number[] = []
  const { sourceAdmission, admitted, pauses } = createSourceAdmission()

  const job = createEsportsRefreshJob({
    database,
    createClient: stubClient(stub, calls),
    enqueueBackfill: async (id) => {
      backfills.push(id)
    },
  })

  await enqueue(database, esportsRefreshContract, brawlhallaId)

  const outcome = await runJobOnce(createQueue(database, job), job, { sourceAdmission })

  return { outcome, calls, backfills, admitted, pauses }
}

describe('esports refresh job', () => {
  test('refresh stores none on a 404 and makes no other call', async () => {
    const { outcome, calls, admitted, backfills } = await runRefresh(answers({ player: null }))

    const { row } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('succeeded')
    expect(calls).toEqual(['player'])
    expect(admitted).toEqual(['brawltools'])
    expect(row?.link).toBe('none')
    expect(backfills).toEqual([])
  })

  test('refresh stores pr, placements and legends for a linked player', async () => {
    const pr1v1 = powerRanking({ earnings: 1200, rank: 14, region: 'EU' })
    const pr2v2 = powerRanking({ earnings: 1200, rank: 30, region: 'EU' })

    const stub = answers({
      player,
      pr: { 1: pr1v1, 2: pr2v2 },
      placements: { 1: [rawPlacement('solo/1v1', 3, daysAgo(30))], 2: [rawPlacement('duo/2v2', 12, daysAgo(40))] },
      legends: [{ name: 'MORDEX', count: 40 }],
    })

    const { outcome, calls } = await runRefresh(stub)
    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('succeeded')
    expect(calls.slice(0, 6)).toEqual(['player', 'pr 1', 'pr 2', 'placements 1', 'placements 2', 'legends'])
    expect(row).toMatchObject({ link: 'linked', brawltoolsPlayerId: 77, brawltoolsName: 'Ember', failureCount: 0 })
    expect(row?.eventLegends).toEqual([{ name: 'MORDEX', count: 40 }])
    expect(stored.pr1v1).toEqual(pr1v1)
    expect(stored.pr2v2).toEqual(pr2v2)

    expect(stored.placements.map(({ mode, tournamentId, placement }) => [mode, tournamentId, placement])).toEqual([
      [1, 'solo/1v1', 3],
      [2, 'duo/2v2', 12],
    ])
  })

  test('refresh fetches sets for the highlight events of All, 1v1 and 2v2, at most 12 deduplicated', async () => {
    // a 1v1 run of six top-8 finishes, newest best, and the same in 2v2 a year earlier
    const solo = [1, 2, 3, 4, 5, 6].map((place) => rawPlacement(`solo-${place}`, place, daysAgo(10 + place)))
    const duo = [1, 2, 3, 4, 5, 6].map((place) => rawPlacement(`duo-${place}`, place, daysAgo(400 + place)))
    const outsideTop8 = rawPlacement('solo-outside', 9, daysAgo(2))
    const crewBattle = rawPlacement('solo-crew', 1, daysAgo(3), 'Winter Crew Battle')

    const stub = answers({
      player,
      placements: { 1: [...solo, outsideTop8, crewBattle], 2: duo },
      matches: new Map([['solo-1', [match({ matchId: 'won' })]]]),
    })

    const { calls } = await runRefresh(stub)
    const { stored } = await readStoredEsports(database, brawlhallaId)

    const fetchedEvents = calls.filter((call) => call.startsWith('matches ')).map((call) => call.slice(8))

    // All takes solo-1, duo-1, solo-2 and duo-2, which the 1v1 and 2v2 filters take too
    expect(fetchedEvents.toSorted()).toEqual(
      ['duo-1', 'duo-2', 'duo-3', 'duo-4', 'solo-1', 'solo-2', 'solo-3', 'solo-4'].toSorted(),
    )

    expect(fetchedEvents.length).toBeLessThanOrEqual(12)
    expect(stored.setsByTournament.get('solo-1')?.map((set) => set.matchId)).toEqual(['won'])
    expect(stored.setsByTournament.get('duo-4')).toEqual([])
    expect(stored.setsByTournament.has('solo-5')).toBe(false)
  })

  test('refresh does not fetch the final sets of a highlight event again', async () => {
    await saveRefresh(database, {
      brawlhallaId,
      link: 'linked',
      player,
      pr1v1: null,
      pr2v2: null,
      placements: [placement({ tournamentId: 'old-final', startTime: daysAgo(60), placement: 1 })],
      eventLegends: [],
      checkedAt: daysAgo(8),
    })

    await saveEventSets(database, brawlhallaId, 'old-final', [match({ matchId: 'kept' })], daysAgo(50))

    const stub = answers({
      player,
      placements: { 1: [rawPlacement('old-final', 1, daysAgo(60)), rawPlacement('new', 2, daysAgo(1))], 2: [] },
    })

    const { calls } = await runRefresh(stub)
    const { stored } = await readStoredEsports(database, brawlhallaId)

    expect(calls.filter((call) => call.startsWith('matches '))).toEqual(['matches new'])
    expect(stored.setsByTournament.get('old-final')?.map((set) => set.matchId)).toEqual(['kept'])
  })

  test('refresh asks for a backfill after saving', async () => {
    const backfillsSeen: string[] = []
    const calls: string[] = []
    const { sourceAdmission } = createSourceAdmission()

    const job = createEsportsRefreshJob({
      database,
      createClient: stubClient(
        answers({ player, placements: { 1: [rawPlacement('solo', 2, daysAgo(5))], 2: [] } }),
        calls,
      ),
      enqueueBackfill: async (id) => {
        const { row, stored } = await readStoredEsports(database, id)

        backfillsSeen.push(`${id} ${row?.link} ${stored.placements.length} placements`)
      },
    })

    await enqueue(database, esportsRefreshContract, brawlhallaId)
    await runJobOnce(createQueue(database, job), job, { sourceAdmission })

    expect(backfillsSeen).toEqual([`${brawlhallaId} linked 1 placements`])
  })

  test('a 503 records a failure and keeps the stored data', async () => {
    await saveRefresh(database, {
      brawlhallaId,
      link: 'linked',
      player,
      pr1v1: null,
      pr2v2: null,
      placements: [placement({ tournamentId: 'kept/1v1' })],
      eventLegends: [],
      checkedAt: daysAgo(8),
    })

    const unavailable = new BrawltoolsHttpError('brawltools answered 503 for /player/pr', 503, '/player/pr')
    const stub = answers({ player, failures: new Map([['pr 1', unavailable]]) })

    const { outcome, backfills } = await runRefresh(stub)
    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('succeeded')
    expect((await readOperation(database, 'esports-refresh')).status).toBe('succeeded')
    expect(row).toMatchObject({ link: 'linked', failureCount: 1 })
    expect(stored.placements.map((stored) => stored.tournamentId)).toEqual(['kept/1v1'])
    expect(backfills).toEqual([])
  })

  test('a 500 records a failure like a 503', async () => {
    const serverError = new BrawltoolsHttpError('brawltools answered 500 for /player/pr', 500, '/player/pr')
    const { outcome } = await runRefresh(answers({ player, failures: new Map([['pr 2', serverError]]) }))

    const { row } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('succeeded')
    expect((await readOperation(database, 'esports-refresh')).status).toBe('succeeded')
    expect(row?.failureCount).toBe(1)
  })

  test('a 503 while fetching highlight sets keeps the saved profile and records a failure', async () => {
    const unavailable = new BrawltoolsHttpError('brawltools answered 503 for /player/match', 503, '/player/match')

    const stub = answers({
      player,
      placements: { 1: [rawPlacement('solo', 1, daysAgo(3))], 2: [] },
      failures: new Map([['matches solo', unavailable]]),
    })

    const { outcome, backfills } = await runRefresh(stub)
    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('succeeded')
    expect(stored.placements.map((saved) => saved.tournamentId)).toEqual(['solo'])
    expect(row).toMatchObject({ link: 'linked', failureCount: 1 })
    expect(row?.checkedAt.getTime()).toBeGreaterThan(row?.lastSuccessAt?.getTime() ?? Number.POSITIVE_INFINITY)
    expect(backfills).toEqual([])
  })

  test('a timeout records a failure like a 503', async () => {
    const timeout = new BrawltoolsNetworkError(
      'brawltools request timed out after 10000 ms: /player/bhId/:id',
      '/player/bhId/:id',
    )

    const { outcome } = await runRefresh(answers({ failures: new Map([['player', timeout]]) }))

    const { row } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('succeeded')
    expect(row?.failureCount).toBe(1)
  })

  test('a malformed brawltools body records a failure', async () => {
    const malformed = new Error('brawltools sent invalid json: /player/placement/:id')
    const { outcome } = await runRefresh(answers({ player, failures: new Map([['placements 1', malformed]]) }))

    const operation = await readOperation(database, 'esports-refresh')
    const { row } = await readStoredEsports(database, brawlhallaId)

    // the job still fails, so the error reaches the dead letters, but the read now backs off a day
    expect(outcome).toBe('retry')
    expect(operation.errorCode).toBe('esports_refresh_failed')
    expect(row).toMatchObject({ link: 'none', failureCount: 1 })
  })

  test('a spent brawltools budget defers without counting a failure', async () => {
    const budgetSpent = new SourceAdmissionLimitedError(20)
    const { outcome } = await runRefresh(answers({ player, failures: new Map([['pr 1', budgetSpent]]) }))

    const { row } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('retry')
    expect((await readOperation(database, 'esports-refresh')).attemptCount).toBe(0)
    expect(row).toBeNull()
  })

  test('a 429 pauses the brawltools source and defers', async () => {
    const rateLimited = new BrawltoolsRateLimitError('/player/placement', 3_600)
    const stub = answers({ player, failures: new Map([['placements 1', rateLimited]]) })

    const { outcome, pauses } = await runRefresh(stub)
    const operation = await readOperation(database, 'esports-refresh')
    const { row } = await readStoredEsports(database, brawlhallaId)

    // the hour brawltools asked for is cut to the ten minute cap
    expect(outcome).toBe('retry')
    expect(pauses).toEqual([{ domain: 'brawltools', seconds: 600 }])
    expect(operation).toMatchObject({ status: 'pending', attemptCount: 0, errorCode: 'source_rate_limited' })
    expect(operation.waitSeconds).toBeGreaterThan(590)
    expect(operation.waitSeconds).toBeLessThanOrEqual(600)
    expect(row).toBeNull()
  })
})
