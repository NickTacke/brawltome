import { describe, expect, test } from 'bun:test'
import { BhApiClient } from '@brawltome/bhapi'
import { StatisticsSourceOutageError } from '@brawltome/statistics'
import {
  createStatisticsCollection,
  createStatisticsCollectionPace,
  createStatisticsCollectionQueue,
  STATISTICS_COLLECTION_SPACING_MS,
} from '../src/statistics-collection-source'

describe('Statistics collection request queue', () => {
  test('spaces calls evenly over the 150 per 15 minutes the cohort declares', () => {
    expect(STATISTICS_COLLECTION_SPACING_MS).toBe(6_000)
    expect(createStatisticsCollectionQueue().remainingBackground).toBe(150)
  })

  test('holds the next call instead of releasing a burst', async () => {
    const queue = createStatisticsCollectionQueue()

    await queue.acquire('background')

    const next = queue.acquire('background').then(() => 'released')
    const outcome = await Promise.race([next, Bun.sleep(100).then(() => 'waiting')])

    expect(outcome).toBe('waiting')
  })
})

describe('Statistics collection pace', () => {
  test('books one slot per operation, spaced by the collection pace', () => {
    let currentTime = 1_000_000
    const pace = createStatisticsCollectionPace(() => currentTime)

    expect(pace.waitMsForTurn('first')).toBe(0)
    expect(pace.waitMsForTurn('second')).toBe(6_000)
    expect(pace.waitMsForTurn('third')).toBe(12_000)

    currentTime += 6_000

    expect(pace.waitMsForTurn('second')).toBe(0)
  })

  test('tells a job that wakes early how much of its own wait is left', () => {
    let currentTime = 1_000_000
    const pace = createStatisticsCollectionPace(() => currentTime)

    pace.waitMsForTurn('first')
    expect(pace.waitMsForTurn('second')).toBe(6_000)

    currentTime += 1_000

    expect(pace.waitMsForTurn('second')).toBe(5_000)
  })

  test('books a new slot for an operation that comes back after its turn', () => {
    let currentTime = 1_000_000
    const pace = createStatisticsCollectionPace(() => currentTime)

    expect(pace.waitMsForTurn('first')).toBe(0)
    expect(pace.waitMsForTurn('second')).toBe(6_000)

    currentTime += 6_000
    expect(pace.waitMsForTurn('second')).toBe(0)

    currentTime += 1_000
    expect(pace.waitMsForTurn('second')).toBe(5_000)
  })

  test('holds the next slot back after an outage and rebooks jobs that had a slot', () => {
    const currentTime = 1_000_000
    const pace = createStatisticsCollectionPace(() => currentTime)

    expect(pace.waitMsForTurn('first')).toBe(0)
    expect(pace.waitMsForTurn('second')).toBe(6_000)

    pace.holdBackForOutage()

    expect(pace.waitMsForTurn('second')).toBe(15_000)
    expect(pace.waitMsForTurn('third')).toBe(21_000)
  })

  test('doubles the hold while the outage lasts, up to five minutes, and starts over after a success', () => {
    const currentTime = 1_000_000
    const pace = createStatisticsCollectionPace(() => currentTime)

    const holdAfterOutage = (operationId: string) => {
      pace.holdBackForOutage()

      return pace.waitMsForTurn(operationId)
    }

    expect([1, 2, 3, 4, 5, 6, 7, 8].map((operation) => holdAfterOutage(`operation-${operation}`))).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000,
    ])

    pace.endOutageHold()

    expect(holdAfterOutage('after-recovery')).toBe(15_000)
  })
})

describe('Statistics collection worker wiring', () => {
  const rankedPayload = (id: number) => ({
    brawlhalla_id: id,
    name: 'Tracer',
    games: 20,
    wins: 12,
    rating: 2100,
    peak_rating: 2200,
    region: 'EU',
    region_ranks: [],
    legends: [],
  })

  const outages: [string, () => Promise<Response> | Response][] = [
    ['a 503', () => new Response('down', { status: 503 })],
    ['a plain 500', () => new Response('broken', { status: 500 })],
    ['a timeout', () => new Promise<Response>(() => {})],
  ]

  test.each(outages)('%s is reported as an outage and holds back only the next collection slot', async (_, respond) => {
    const server = Bun.serve({ port: 0, fetch: respond })

    const collection = createStatisticsCollection(
      (queue) => new BhApiClient({ apiKey: 'test', baseUrl: server.url.origin, queue, fetchTimeoutMs: 50 }),
    )

    const lease = {
      kind: 'statistics-ranked-collection' as const,
      payload: { cohortId: '10000000-0000-4000-8000-000000000001', brawlhallaId: 42 },
    }

    try {
      await expect(collection.collectEvidence(lease)).rejects.toBeInstanceOf(StatisticsSourceOutageError)

      expect(collection.collectionPace.waitMsForTurn('next')).toBeGreaterThan(STATISTICS_COLLECTION_SPACING_MS)
    } finally {
      server.stop(true)
    }
  })

  test('a 404 for a missing player is not an outage and leaves the pace alone', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('missing', { status: 404 }) })

    const collection = createStatisticsCollection(
      (queue) => new BhApiClient({ apiKey: 'test', baseUrl: server.url.origin, queue }),
    )

    const lease = {
      kind: 'statistics-ranked-collection' as const,
      payload: { cohortId: '10000000-0000-4000-8000-000000000001', brawlhallaId: 42 },
    }

    try {
      await expect(collection.collectEvidence(lease)).rejects.not.toBeInstanceOf(StatisticsSourceOutageError)

      expect(collection.collectionPace.waitMsForTurn('next')).toBe(0)
    } finally {
      server.stop(true)
    }
  })

  test('sends real client requests through the paced queue', async () => {
    let requests = 0

    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++

        return Response.json(rankedPayload(42))
      },
    })

    const collection = createStatisticsCollection(
      (queue) => new BhApiClient({ apiKey: 'test', baseUrl: server.url.origin, queue }),
    )

    const lease = {
      kind: 'statistics-ranked-collection' as const,
      payload: { cohortId: '10000000-0000-4000-8000-000000000001', brawlhallaId: 42 },
    }

    try {
      await collection.collectEvidence(lease)

      // left running on purpose: it is held by the 6-second spacing, which is what this test proves
      const held = collection.collectEvidence(lease).then(
        () => 'released',
        () => 'released',
      )

      const outcome = await Promise.race([held, Bun.sleep(150).then(() => 'waiting')])

      expect(outcome).toBe('waiting')
      expect(requests).toBe(1)
    } finally {
      server.stop(true)
    }
  })
})
