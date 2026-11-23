import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { readStoredEsports } from '../../db/read-stored-esports'
import { saveEventSets } from '../../db/save-event-sets'
import { type RefreshInput, saveRefresh } from '../../db/save-refresh'
import { esportsModule } from '../../index'
import { esportsSetsBackfillContract } from '../../jobs/esports-sets-backfill-contract'
import { createEsportsSetsBackfillJob } from '../../jobs/esports-sets-backfill-job'
import { BrawltoolsHttpError, BrawltoolsRateLimitError } from '../../source/brawltools-client'
import { match, placement } from '../domain/builders'
import {
  answers,
  type BrawltoolsAnswers,
  createQueue,
  createSourceAdmission,
  enqueue,
  readOperation,
  stubClient,
} from './job-harness'

const brawlhallaId = 4343
const player = { playerId: 88, name: 'Ash', brawlhallaId }
const dayMs = 24 * 60 * 60 * 1000

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'esports_backfill',
    modules: [queueModule, playerModule, esportsModule],
  })
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

function linkedRefresh(overrides: Partial<RefreshInput> = {}): RefreshInput {
  return {
    brawlhallaId,
    link: 'linked',
    player,
    pr1v1: null,
    pr2v2: null,
    placements: [],
    eventLegends: [],
    checkedAt: daysAgo(1),
    ...overrides,
  }
}

async function runBackfill(stub: BrawltoolsAnswers) {
  const calls: string[] = []
  const { sourceAdmission, admitted, pauses } = createSourceAdmission()
  const job = createEsportsSetsBackfillJob({ database, createClient: stubClient(stub, calls) })

  await enqueue(database, esportsSetsBackfillContract, brawlhallaId)

  const outcome = await runJobOnce(createQueue(database, job), job, { sourceAdmission })

  return { outcome, calls, admitted, pauses }
}

describe('esports sets backfill job', () => {
  test('backfill fetches sets only for events listEventsMissingSets returns, one admitted call each', async () => {
    await saveRefresh(
      database,
      linkedRefresh({
        placements: [
          placement({ tournamentId: 'final-fetched', startTime: daysAgo(60) }),
          placement({ tournamentId: 'never-fetched', startTime: daysAgo(30) }),
          placement({ tournamentId: 'fetched-while-running', startTime: daysAgo(20) }),
        ],
      }),
    )

    await saveEventSets(database, brawlhallaId, 'final-fetched', [match({ matchId: 'kept' })], daysAgo(50))
    await saveEventSets(database, brawlhallaId, 'fetched-while-running', [], daysAgo(19))

    const stub = answers({
      matches: new Map([
        ['never-fetched', [match({ matchId: 'new' })]],
        ['fetched-while-running', [match({ matchId: 'complete' })]],
      ]),
    })

    const { outcome, calls, admitted } = await runBackfill(stub)
    const { stored } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('succeeded')
    expect(calls.toSorted()).toEqual(['matches fetched-while-running', 'matches never-fetched'])
    expect(admitted).toEqual(['brawltools', 'brawltools'])
    expect(stored.setsByTournament.get('never-fetched')?.map((set) => set.matchId)).toEqual(['new'])
    expect(stored.setsByTournament.get('fetched-while-running')?.map((set) => set.matchId)).toEqual(['complete'])
    expect(stored.setsByTournament.get('final-fetched')?.map((set) => set.matchId)).toEqual(['kept'])
  })

  test('backfill makes no call for a player brawltools does not know', async () => {
    await saveRefresh(database, linkedRefresh({ link: 'none', player: null }))

    const { outcome, calls } = await runBackfill(answers())

    expect(outcome).toBe('succeeded')
    expect(calls).toEqual([])
  })

  test('a 503 during the backfill records a failure and keeps the sets already saved', async () => {
    await saveRefresh(
      database,
      linkedRefresh({
        placements: [
          placement({ tournamentId: 'a-first', startTime: daysAgo(30) }),
          placement({ tournamentId: 'b-down', startTime: daysAgo(40) }),
        ],
      }),
    )

    const unavailable = new BrawltoolsHttpError('brawltools answered 503 for /player/match', 503, '/player/match')

    const stub = answers({
      matches: new Map([['a-first', [match({ matchId: 'saved' })]]]),
      failures: new Map([['matches b-down', unavailable]]),
    })

    const { outcome } = await runBackfill(stub)
    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(outcome).toBe('succeeded')
    expect(row?.failureCount).toBe(1)
    expect(stored.setsByTournament.get('a-first')?.map((set) => set.matchId)).toEqual(['saved'])
  })

  test('backfill stops between events once the lease is lost', async () => {
    await saveRefresh(
      database,
      linkedRefresh({
        placements: [
          placement({ tournamentId: 'a-first', startTime: daysAgo(30) }),
          placement({ tournamentId: 'b-second', startTime: daysAgo(40) }),
        ],
      }),
    )

    const calls: string[] = []
    const leaseLost = new AbortController()
    const createClient = stubClient(answers(), calls)

    // the lease is lost while the first event is being fetched
    const job = createEsportsSetsBackfillJob({
      database,
      createClient: (admit) =>
        createClient(async () => {
          await admit()
          leaseLost.abort()
        }),
    })

    const tools = {
      signal: leaseLost.signal,
      createSourceAdmitter: () => async () => {},
      queue: { complete: async () => 'lease-lost' },
    }

    const lease = { payload: { brawlhallaId } }

    expect(await job.run(lease as never, tools as never)).toBe('lease_lost')
    expect(calls).toEqual(['matches a-first'])
  })

  test('a 429 during the backfill pauses the brawltools source and defers', async () => {
    await saveRefresh(database, linkedRefresh({ placements: [placement({ tournamentId: 'slow' })] }))

    const rateLimited = new BrawltoolsRateLimitError('/player/match', 30)
    const { outcome, pauses } = await runBackfill(answers({ failures: new Map([['matches slow', rateLimited]]) }))

    expect(outcome).toBe('retry')
    expect(pauses).toEqual([{ domain: 'brawltools', seconds: 30 }])
    expect((await readOperation(database, 'esports-sets-backfill')).status).toBe('pending')
  })
})
