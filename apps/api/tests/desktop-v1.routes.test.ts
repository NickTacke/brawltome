import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { DesktopLobbyContract } from '@brawltome/contracts'
import type { PlayerRefreshReservations } from '@brawltome/player'
import { createMemorySink, createTelemetry, type Telemetry } from '@brawltome/telemetry'
import { readMinimumDesktopVersion } from '../src/desktop/desktop-version'
import type { LobbyReads } from '../src/desktop/read-lobby'
import { createDesktopRefresher, type DesktopRefresher, type DesktopRefreshState } from '../src/desktop/request-refresh'
import { createDesktopV1Routes, lobbiesPerMinute } from '../src/routes/desktop-v1.routes'
import { createVisitLimiter, type VisitLimiter } from '../src/visits'
import { fakeLobbyReads, rankedProfile } from './fixtures/desktop-stored-data'

function contractFixture(name: '1v1' | 'no-data'): DesktopLobbyContract {
  const url = new URL(`../../../packages/contracts/tests/fixtures/desktop-v1-lobby-${name}.json`, import.meta.url)

  return JSON.parse(readFileSync(url, 'utf8'))
}

function refreshingFixture(): DesktopLobbyContract {
  const [card] = contractFixture('1v1').cards
  const players = card.players.map((player) => ({ ...player, isRefreshing: true }))

  return { cards: [{ ...card, players }] }
}

const sandstorm = {
  brawlhallaId: 91913839,
  lastSuccessAt: new Date('2026-11-16T10:00:00.000Z'),
  oneVsOne: { rating: 2112, peakRating: 2240, tier: 'Diamond', wins: 734, games: 1204 },
  region: 'EU',
}

const names = { 91913839: 'Sandstorm' }
const sandstormLobby = { matchType: '1v1', players: [{ brawlhallaId: 91913839, team: 2 }] }

function storedSandstorm(freshness: 'fresh' | 'stale') {
  return fakeLobbyReads({
    profiles: [rankedProfile({ ...sandstorm, freshness })],
    names,
    regionRanks: { 91913839: 48 },
  })
}

type RefreshRequest = Parameters<DesktopRefresher['request']>[0]

const requested: DesktopRefreshState = { state: 'requested', retryAfterSeconds: 2 }

// a refresher that remembers what it was asked; every request is requested unless the answer says otherwise
function fakeRefresher(answer: (input: RefreshRequest) => DesktopRefreshState = () => requested) {
  const requests: RefreshRequest[] = []

  const refresher: DesktopRefresher = {
    isBudgetOpen: async () => true,
    request: async (input) => {
      requests.push(input)

      return answer(input)
    },
  }

  return { refresher, requests }
}

type QueueOptions = { usedV0Calls?: number; isUsageUnreadable?: boolean }

// in-memory reservations and admission behind a real refresher, recording what each was handed
function fakeRefreshQueue({ usedV0Calls = 0, isUsageUnreadable = false }: QueueOptions = {}) {
  const reserved: Parameters<PlayerRefreshReservations['reserveInteractivePlayerRefresh']>[0][] = []
  const admittedActors: unknown[] = []

  const playerRefreshReservations = {
    findActiveInteractivePlayerRefresh: async () => null,
    reserveInteractivePlayerRefresh: async (input: (typeof reserved)[number]) => {
      reserved.push(input)

      return { outcome: 'reserved' as const, operationId: `operation-${reserved.length}`, reservationToken: 'token' }
    },
    activateInteractivePlayerRefresh: async () => 'transitioned' as const,
    rejectInteractivePlayerRefresh: async () => 'transitioned' as const,
  } as unknown as PlayerRefreshReservations

  const requestAdmission = {
    admitActor: async (actor: unknown) => {
      admittedActors.push(actor)

      return { outcome: 'admitted' as const }
    },
    admitActorOnce: async () => ({ outcome: 'admitted' as const }),
    hasActorReservation: async () => false,
    inspectCurrentUsage: async () => {
      if (isUsageUnreadable) throw new Error('admission database unavailable')

      return {
        observedAt: '2026-11-16T10:00:00.000Z',
        windowStartedAt: '2026-11-16T09:45:00.000Z',
        domains: [{ domain: 'brawlhalla-v0' as const, used: usedV0Calls, limit: 180 }],
      }
    },
  }

  return { playerRefreshReservations, requestAdmission, reserved, admittedActors }
}

type HarnessOptions = {
  reads?: LobbyReads
  refresher?: DesktopRefresher
  lobbyLimiter?: VisitLimiter
  telemetry?: Telemetry
  minimumVersion?: string
}

function createHarness(options: HarnessOptions = {}) {
  const telemetry = options.telemetry ?? createTelemetry({ service: 'api', drainIntervalMs: 0 })

  const app = createDesktopV1Routes({
    minimumVersion: readMinimumDesktopVersion(options.minimumVersion ?? '0.2.0'),
    lobbyReads: options.reads ?? fakeLobbyReads({}).reads,
    refresher: options.refresher ?? fakeRefresher().refresher,
    lobbyLimiter: options.lobbyLimiter ?? createVisitLimiter(lobbiesPerMinute, Date.now),
    telemetry,
  })

  function send(body: unknown, headers: Record<string, string> = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)

    const requestHeaders = {
      'content-type': 'application/json',
      'x-desktop-version': '0.2.0',
      'x-client-ip': '203.0.113.42',
      ...headers,
    }

    return app.request('/lobby', { method: 'POST', headers: requestHeaders, body: text })
  }

  return { send }
}

function refresherOver(queue: ReturnType<typeof fakeRefreshQueue>, telemetry?: Telemetry) {
  return createDesktopRefresher({
    playerRefreshReservations: queue.playerRefreshReservations,
    requestAdmission: queue.requestAdmission,
    telemetry: telemetry ?? createTelemetry({ service: 'api', drainIntervalMs: 0 }),
  })
}

describe('desktop lobby route', () => {
  test('answers a 1v1 lobby from stored data and reserves nothing when everyone is fresh', async () => {
    const { refresher, requests } = fakeRefresher()
    const harness = createHarness({ reads: storedSandstorm('fresh').reads, refresher })

    const response = await harness.send(sandstormLobby)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(contractFixture('1v1'))
    expect(requests).toEqual([])
  })

  test('asks for a refresh of a stale opponent with the dedupe key of the overlay route and the desktop actor', async () => {
    const queue = fakeRefreshQueue()
    const harness = createHarness({ reads: storedSandstorm('stale').reads, refresher: refresherOver(queue) })

    const response = await harness.send(sandstormLobby)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(refreshingFixture())

    expect(queue.reserved).toEqual([
      expect.objectContaining({
        dedupeKey: `desktop-player:91913839:ranked:${sandstorm.lastSuccessAt.getTime()}`,
        brawlhallaId: 91913839,
        staleSections: ['ranked'],
        provenance: { source: 'desktop-api' },
      }),
    ])

    expect(queue.admittedActors).toEqual([{ kind: 'desktop', ip: '203.0.113.42' }])
  })

  test('asks for a refresh of a player we hold nothing on', async () => {
    const queue = fakeRefreshQueue()
    const harness = createHarness({ refresher: refresherOver(queue) })

    const response = await harness.send({ matchType: '1v1', players: [{ brawlhallaId: 60417325, team: 2 }] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(contractFixture('no-data'))
    expect(queue.reserved.map((reservation) => reservation.dedupeKey)).toEqual(['desktop-player:60417325:ranked:0'])
  })

  test('skips refreshes, not cards, when the Brawlhalla budget is three quarters used', async () => {
    const spentQueue = fakeRefreshQueue({ usedV0Calls: 135 })
    const spent = createHarness({ reads: storedSandstorm('stale').reads, refresher: refresherOver(spentQueue) })

    const spentResponse = await spent.send(sandstormLobby)

    expect(spentResponse.status).toBe(200)
    expect(await spentResponse.json()).toEqual(contractFixture('1v1'))
    expect(spentQueue.reserved).toEqual([])
    expect(spentQueue.admittedActors).toEqual([])

    const openQueue = fakeRefreshQueue({ usedV0Calls: 134 })
    const open = createHarness({ reads: storedSandstorm('stale').reads, refresher: refresherOver(openQueue) })

    const openResponse = await open.send(sandstormLobby)

    expect(await openResponse.json()).toEqual(refreshingFixture())
    expect(openQueue.reserved).toHaveLength(1)
  })

  test('skips refreshes when the budget cannot be read', async () => {
    const queue = fakeRefreshQueue({ isUsageUnreadable: true })
    const harness = createHarness({ reads: storedSandstorm('stale').reads, refresher: refresherOver(queue) })

    const response = await harness.send(sandstormLobby)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(contractFixture('1v1'))
    expect(queue.reserved).toEqual([])
  })

  test('answers 503 with retry-after when a stored read fails', async () => {
    const { reads } = storedSandstorm('stale')
    const { refresher, requests } = fakeRefresher()

    const failingReads: LobbyReads = {
      ...reads,
      rankedPlayers: {
        byId: async () => {
          throw new Error('database unavailable')
        },
      },
    }

    const harness = createHarness({ reads: failingReads, refresher })

    const response = await harness.send(sandstormLobby)

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('5')
    expect(await response.json()).toEqual({ error: 'temporarily_unavailable' })
    expect(requests).toEqual([])
  })

  test('limits each address to 30 lobbies a minute, not everyone together', async () => {
    const harness = createHarness({ reads: storedSandstorm('fresh').reads })
    const fromFirst = { 'x-client-ip': '203.0.113.1' }

    for (let lobby = 0; lobby < 30; lobby++) {
      const response = await harness.send(sandstormLobby, fromFirst)

      expect(response.status).toBe(200)
    }

    const limited = await harness.send(sandstormLobby, fromFirst)

    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(await limited.json()).toEqual({ error: 'rate_limited' })

    const fromSecond = await harness.send(sandstormLobby, { 'x-client-ip': '203.0.113.2' })

    expect(fromSecond.status).toBe(200)
  })

  test('answers 400 for a body that is not a lobby', async () => {
    const harness = createHarness()
    const player = (brawlhallaId: number) => ({ brawlhallaId, team: 2 })
    const fivePlayers = { matchType: '2v2', players: [1, 2, 3, 4, 5].map(player) }
    const sameIdTwice = { matchType: '2v2', players: [player(7), player(7)] }

    for (const body of ['not json', fivePlayers, sameIdTwice]) {
      const response = await harness.send(body)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_request' })
    }
  })

  test('marks only the players whose refresh was requested as refreshing', async () => {
    const tidewater = { ...sandstorm, brawlhallaId: 40218877, region: 'US-E' }

    const { reads } = fakeLobbyReads({
      profiles: [
        rankedProfile({ ...sandstorm, freshness: 'stale' }),
        rankedProfile({ ...tidewater, freshness: 'stale' }),
      ],
    })

    const { refresher, requests } = fakeRefresher((input) =>
      input.brawlhallaId === tidewater.brawlhallaId ? { state: 'limited', retryAfterSeconds: 120 } : requested,
    )

    const harness = createHarness({ reads, refresher })

    const response = await harness.send({
      matchType: '2v2',
      players: [
        { brawlhallaId: 91913839, team: 2 },
        { brawlhallaId: 40218877, team: 2 },
      ],
    })

    const lobby: DesktopLobbyContract = await response.json()
    const refreshing = lobby.cards[0].players.map((player) => [player.brawlhallaId, player.isRefreshing])

    expect(response.status).toBe(200)
    expect(requests).toHaveLength(2)

    expect(refreshing).toEqual([
      [91913839, true],
      [40218877, false],
    ])
  })

  test('answers 400 for a body over 8 KiB before anything is read', async () => {
    const { reads } = storedSandstorm('fresh')
    let profileReads = 0

    const countingReads: LobbyReads = {
      ...reads,
      rankedPlayers: {
        byId: async (brawlhallaId) => {
          profileReads++

          return reads.rankedPlayers.byId(brawlhallaId)
        },
      },
    }

    const harness = createHarness({ reads: countingReads })

    // a lobby the schema would take, so only the size can refuse it
    const response = await harness.send({ ...sandstormLobby, padding: 'x'.repeat(64 * 1024) })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
    expect(profileReads).toBe(0)
  })

  test('answers 426 before anything is read for an app under the minimum', async () => {
    const { reads, calls } = storedSandstorm('fresh')
    let profileReads = 0
    let limiterCounts = 0

    const countingReads: LobbyReads = {
      ...reads,
      rankedPlayers: {
        byId: async (brawlhallaId) => {
          profileReads++

          return reads.rankedPlayers.byId(brawlhallaId)
        },
      },
    }

    const countingLimiter: VisitLimiter = {
      allow: () => {
        limiterCounts++

        return true
      },
    }

    const harness = createHarness({ reads: countingReads, lobbyLimiter: countingLimiter })

    const response = await harness.send(sandstormLobby, { 'x-desktop-version': '0.1.9' })

    expect(response.status).toBe(426)
    expect(await response.json()).toEqual({ minimumVersion: '0.2.0' })
    expect(profileReads).toBe(0)
    expect(calls.standingById).toEqual([])
    expect(limiterCounts).toBe(0)
  })

  test('counts the lookup, its misses and its duration without naming anyone', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'api', sink, drainIntervalMs: 0 })
    const refresher = refresherOver(fakeRefreshQueue(), telemetry)
    const harness = createHarness({ refresher, telemetry })

    const response = await harness.send({ matchType: '1v1', players: [{ brawlhallaId: 91913839, team: 2 }] })

    expect(response.status).toBe(200)

    await telemetry.flush(1_000)

    const metrics = telemetry.metrics.snapshot()
    const seriesOf = (name: string) => metrics.find((metric) => metric.name === name)?.series ?? []

    expect(seriesOf('desktop_requests_total')).toEqual([
      expect.objectContaining({ labels: { endpoint: 'lobby', outcome: 'ok' }, value: 1 }),
    ])

    expect(seriesOf('desktop_lobby_cards_total')).toEqual([
      expect.objectContaining({ labels: { match_type: '1v1', source: 'none' }, value: 1 }),
    ])

    expect(seriesOf('desktop_request_duration_ms')).toEqual([
      expect.objectContaining({ labels: { endpoint: 'lobby' }, count: 1 }),
    ])

    expect(seriesOf('refresh_requests_total')).toEqual([
      expect.objectContaining({
        labels: { kind: 'player', outcome: 'accepted', source: 'desktop-api' },
        value: 1,
      }),
    ])

    const answered = sink.records.filter((record) => record.event === 'desktop.lobby.answered')

    expect(answered.map((record) => record.attributes)).toEqual([
      { version: '0.2.0', matchType: '1v1', players: 1, misses: 1, refreshes: 1 },
    ])

    const everything = JSON.stringify({ logs: sink.records, metrics })

    expect(everything).not.toContain('203.0.113.42')
    expect(everything).not.toContain('91913839')
  })

  test('counts refused lobbies by why they were refused', async () => {
    const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })

    const failingReads: LobbyReads = {
      ...fakeLobbyReads({}).reads,
      rankedPlayers: {
        byId: async () => {
          throw new Error('database unavailable')
        },
      },
    }

    const healthy = createHarness({ telemetry, lobbyLimiter: { allow: () => false } })
    const failing = createHarness({ telemetry, reads: failingReads })

    await healthy.send(sandstormLobby, { 'x-desktop-version': '0.1.0' })
    await healthy.send(sandstormLobby)
    await failing.send('not json')
    await failing.send(sandstormLobby)

    const requests = telemetry.metrics.snapshot().find((metric) => metric.name === 'desktop_requests_total')
    const outcomes = requests?.series.map((series) => [series.labels.outcome, series.value])

    expect(Object.fromEntries(outcomes ?? [])).toEqual({ update_required: 1, rate_limited: 1, invalid: 1, failed: 1 })
  })
})
