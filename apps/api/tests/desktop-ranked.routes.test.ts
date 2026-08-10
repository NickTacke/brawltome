import { describe, expect, test } from 'bun:test'
import { createDesktopRankedRoutes } from '../src/routes/desktop-ranked.routes'

const freshProfile = (observedAt: Date) => ({
  brawlhallaId: 42,
  checkedAt: observedAt,
  lastSuccessAt: observedAt,
  freshness: 'fresh' as const,
  freshForSeconds: 3600,
  sparsePulse: null,
  snapshot: {
    oneVsOne: {
      rating: 0,
      peakRating: 782,
      tier: 'Tin 0',
      wins: 0,
      games: 0,
      region: 'US-E',
      globalRank: null,
      regionRank: null,
    },
    rankedLegends: [],
    mainLegend: null,
    fixedTeams: [],
    soloQueue: [],
    ratingHistory: [],
    observedRatingDirection: null,
  },
})

describe('desktop ranked lookup route', () => {
  test('returns fresh measured zero before actor admission', async () => {
    const observedAt = new Date()
    const calls = { active: 0, reserve: 0, admit: 0 }
    const app = createDesktopRankedRoutes({
      playerReferences: { byId: async () => ({ brawlhallaId: 42, name: 'Measured Zero' }) },
      rankedPlayers: { byId: async () => freshProfile(observedAt) },
      refreshOperations: {
        findActiveInteractivePlayerRefresh: async () => {
          calls.active++
          return null
        },
        reserveInteractivePlayerRefresh: async () => {
          calls.reserve++
          throw new Error('fresh cache must not reserve work')
        },
      },
      requestAdmission: {
        admitActor: async () => {
          calls.admit++
          throw new Error('fresh cache must not consume admission')
        },
      },
    })

    const response = await app.request('/opponent/42', {
      headers: { 'x-client-ip': '203.0.113.42' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      player: { brawlhallaId: 42, name: 'Measured Zero' },
      ranked: {
        ...freshProfile(observedAt),
        checkedAt: observedAt.toISOString(),
        lastSuccessAt: observedAt.toISOString(),
      },
      refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
    })
    expect(calls).toEqual({ active: 0, reserve: 0, admit: 0 })
  })

  test('bounds concurrent unauthenticated cache reads before querying dependencies', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const observedAt = new Date()
    const app = createDesktopRankedRoutes({
      playerReferences: {
        byId: async () => {
          await gate
          return { brawlhallaId: 42, name: 'Cached Ada' }
        },
      },
      rankedPlayers: {
        byId: async () => {
          await gate
          return freshProfile(observedAt)
        },
      },
      refreshOperations: {} as never,
      requestAdmission: {} as never,
    })
    const active = Array.from({ length: 32 }, () => app.request('/opponent/42'))
    await Bun.sleep(10)

    const rejected = await app.request('/opponent/42')
    expect(rejected.status).toBe(429)

    release?.()
    expect((await Promise.all(active)).every((response: Response) => response.status === 200)).toBe(true)
  })

  test('keeps independently fresh ranked data when the player reference is unavailable', async () => {
    const observedAt = new Date()
    const app = createDesktopRankedRoutes({
      playerReferences: {
        byId: async () => {
          throw new Error('reference unavailable')
        },
      },
      rankedPlayers: { byId: async () => freshProfile(observedAt) },
      refreshOperations: {
        findActiveInteractivePlayerRefresh: async () => {
          throw new Error('fresh ranked data must not request refresh')
        },
      },
      requestAdmission: {
        admitActor: async () => {
          throw new Error('fresh ranked data must not consume admission')
        },
      },
    })

    const body = await (await app.request('/opponent/42')).json()

    expect(body).toMatchObject({
      player: null,
      ranked: { freshness: 'fresh', snapshot: { oneVsOne: { rating: 0 } } },
      refresh: { outcome: 'notNeeded' },
    })
  })

  test('maps an API dependency failure to temporary unavailability without inventing ranked data', async () => {
    const app = createDesktopRankedRoutes({
      playerReferences: { byId: async () => ({ brawlhallaId: 42, name: 'Cached Ada' }) },
      rankedPlayers: {
        byId: async () => {
          throw new Error('database unavailable')
        },
      },
      refreshOperations: {
        findActiveInteractivePlayerRefresh: async () => {
          throw new Error('failed reads must not request refresh')
        },
      },
      requestAdmission: {
        admitActor: async () => {
          throw new Error('failed reads must not consume admission')
        },
      },
    })

    const response = await app.request('/opponent/42')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      player: { brawlhallaId: 42, name: 'Cached Ada' },
      ranked: null,
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
    })
  })

  test('preserves stale cache for already-refreshing, rate-limited, and temporary outcomes', async () => {
    const observedAt = new Date('2026-01-01T00:00:00Z')
    const ranked = { ...freshProfile(observedAt), freshness: 'stale' as const }
    const operationId = '2ef5a585-e8b9-46df-8f95-53d03af42d11'
    const shared = {
      playerReferences: { byId: async () => ({ brawlhallaId: 42, name: 'Stale Ada' }) },
      rankedPlayers: { byId: async () => ranked },
    }

    const active = createDesktopRankedRoutes({
      ...shared,
      refreshOperations: {
        findActiveInteractivePlayerRefresh: async () => ({
          operationId,
          awaitingAdmission: false,
          reservationExpired: false,
        }),
      },
      requestAdmission: {
        admitActor: async () => {
          throw new Error('deduplicated work must not consume admission')
        },
      },
    })
    const activeBody = await (await active.request('/opponent/42')).json()
    expect(activeBody).toMatchObject({
      ranked: { freshness: 'stale', snapshot: { oneVsOne: { rating: 0 } } },
      refresh: { outcome: 'alreadyRefreshing', operationId },
    })

    let rejected = false
    const limited = createDesktopRankedRoutes({
      ...shared,
      refreshOperations: {
        findActiveInteractivePlayerRefresh: async () => null,
        reserveInteractivePlayerRefresh: async () => ({
          outcome: 'reserved' as const,
          operationId,
          reservationToken: 'reservation-token',
        }),
        rejectInteractiveRefresh: async () => {
          rejected = true
          return 'transitioned' as const
        },
      },
      requestAdmission: {
        admitActor: async () => ({ outcome: 'rate-limited' as const, retryAfterSeconds: 77 }),
      },
    })
    const limitedBody = await (await limited.request('/opponent/42')).json()
    expect(limitedBody).toMatchObject({
      ranked: { freshness: 'stale', snapshot: { oneVsOne: { rating: 0 } } },
      refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 77 } },
    })
    expect(rejected).toBe(true)

    const temporary = createDesktopRankedRoutes({
      ...shared,
      refreshOperations: {
        findActiveInteractivePlayerRefresh: async () => null,
        reserveInteractivePlayerRefresh: async () => {
          throw new Error('operations unavailable')
        },
      },
      requestAdmission: { admitActor: async () => ({ outcome: 'admitted' as const }) },
    })
    const temporaryBody = await (await temporary.request('/opponent/42')).json()
    expect(temporaryBody).toMatchObject({
      ranked: { freshness: 'stale', snapshot: { oneVsOne: { rating: 0 } } },
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
    })
  })

  test('admits missing data as ranked-only desktop work without inventing values', async () => {
    const operationId = '2ef5a585-e8b9-46df-8f95-53d03af42d11'
    const reservationToken = '9f6cabed-91e6-4e34-a77f-d7fe4b4c6706'
    const calls: { reserve?: unknown; actor?: unknown; reservationKey?: string; activated?: unknown } = {}
    const app = createDesktopRankedRoutes({
      playerReferences: { byId: async () => null },
      rankedPlayers: { byId: async () => null },
      refreshOperations: {
        findActiveInteractivePlayerRefresh: async () => null,
        reserveInteractivePlayerRefresh: async (input: unknown) => {
          calls.reserve = input
          return { outcome: 'reserved' as const, operationId, reservationToken }
        },
        activateInteractiveRefresh: async (id: string, token: string) => {
          calls.activated = { id, token }
          return 'transitioned' as const
        },
        activateAdmittedInteractiveRefresh: async () => 'transitioned' as const,
        rejectInteractiveRefresh: async () => 'transitioned' as const,
        rejectExpiredInteractiveRefresh: async () => 'transitioned' as const,
      },
      requestAdmission: {
        admitActor: async (actor: unknown, reservationKey?: string) => {
          calls.actor = actor
          calls.reservationKey = reservationKey
          return { outcome: 'admitted' as const }
        },
        hasActorReservation: async () => false,
      },
    })

    const response = await app.request('/opponent/42', {
      headers: { 'x-client-ip': '203.0.113.42' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      player: null,
      ranked: null,
      refresh: {
        outcome: 'accepted',
        operationId,
        retry: { kind: 'poll', afterSeconds: 2 },
      },
    })
    expect(calls.reserve).toMatchObject({
      brawlhallaId: 42,
      staleSections: ['ranked'],
      provenance: { source: 'desktop-api' },
    })
    expect(calls.actor).toEqual({ kind: 'desktop', ip: '203.0.113.42' })
    expect(calls.reservationKey).toBe(operationId)
    expect(calls.activated).toEqual({ id: operationId, token: reservationToken })
  })
})
