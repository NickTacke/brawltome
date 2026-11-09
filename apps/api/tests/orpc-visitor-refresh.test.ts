import { describe, expect, test } from 'bun:test'
import type { Database } from '@brawltome/foundation'
import type { ActorAdmissionResult, AdmissionActor } from '@brawltome/request-admission'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { requestWithVerifiedClientIp } from '../src/client-ip'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'
import { createVisitorRefreshProcedures, type VisitorRefreshDependencies } from '../src/orpc/visitor-refresh'

const internalSecret = 'visitor-refresh-test-internal-secret-0123'
const refreshTrustSecret = 'visitor-refresh-test-trust-secret-0123456789'
const now = Date.parse('2026-11-09T12:00:00.000Z')
const freshAt = new Date(now - 60_000)
const staleAt = new Date(now - 2 * 24 * 60 * 60 * 1_000)
const siteAddress = '172.18.0.9'
const visitorAddress = '198.51.100.20'
const siteHeaders = { 'x-internal-secret': internalSecret, 'x-visitor-real-ip': visitorAddress }

type HarnessOptions = {
  lastSuccessAt?: Date
  actor?: ActorAdmissionResult
  verification?: 'valid' | 'invalid' | 'unavailable'
}

function section(lastSuccessAt: Date) {
  return { checkedAt: lastSuccessAt, lastSuccessAt, checkProvenance: { source: 'v1-guild-stats', outcome: 'success' } }
}

function storedClan(lastSuccessAt: Date) {
  return {
    clanId: 77,
    clanName: 'Valhalla',
    clanCreateDate: new Date('2026-01-01T00:00:00.000Z'),
    clanXp: '10',
    clanLifetimeXp: '10',
    notice: null,
    tags: null,
    discordInviteCode: null,
    guildPoints: null,
    isRecruiting: null,
    profile: section(lastSuccessAt),
    roster: section(lastSuccessAt),
    members: [],
  }
}

function reservations() {
  const reserved = { outcome: 'reserved', operationId: crypto.randomUUID(), reservationToken: crypto.randomUUID() }

  return {
    findActiveInteractivePlayerRefresh: async () => null,
    reserveInteractivePlayerRefresh: async () => reserved,
    activateInteractivePlayerRefresh: async () => 'transitioned',
    rejectInteractivePlayerRefresh: async () => 'transitioned',
    findActiveClanRefresh: async () => null,
    reserveClanRefresh: async () => reserved,
    activateClanRefresh: async () => 'transitioned',
    rejectClanRefresh: async () => 'transitioned',
  }
}

function createDependencies(options: HarnessOptions, admitted: AdmissionActor[], challengedIps: string[]) {
  const lastSuccessAt = options.lastSuccessAt ?? staleAt
  const sharedReservations = reservations()

  return {
    playerReferenceQueries: { byId: async () => ({ brawlhallaId: 7, name: 'Seven', aliases: [] }) },
    rankedPlayerQueries: { byId: async () => ({ lastSuccessAt }) },
    careerPlayerQueries: { byId: async () => ({ lastSuccessAt, snapshotSource: 'v0-player-snapshot' }) },
    playerRefreshReservations: sharedReservations,
    clanRepo: { getById: async () => storedClan(lastSuccessAt) },
    clanRefreshReservations: sharedReservations,
    requestAdmission: {
      admitActor: async (actor: AdmissionActor) => {
        admitted.push(actor)

        return options.actor ?? { outcome: 'admitted' }
      },
      hasActorReservation: async () => false,
    },
    verifyRefreshChallenge: async (_token: string, ip: string) => {
      challengedIps.push(ip)

      return options.verification ?? 'valid'
    },
    refreshTrustSecret,
    now: () => now,
  } as unknown as VisitorRefreshDependencies
}

function createHarness(options: HarnessOptions = {}) {
  const admitted: AdmissionActor[] = []
  const challengedIps: string[] = []
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })
  const refresh = createVisitorRefreshProcedures(createDependencies(options, admitted, challengedIps))
  const router = createOrpcRouter([], { database: {} as Database }, { refresh })
  const app = new Hono()

  app.route('/', createOrpcRoutes({ telemetry, internalSecret, router }))

  // goes through the same address check serve.ts runs before any route
  async function post(path: string, body: unknown, headers: Record<string, string> = siteHeaders) {
    const request = new Request(`http://api.test/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

    const response = await app.fetch(requestWithVerifiedClientIp(request, siteAddress, internalSecret))

    return { status: response.status, body: await response.json() }
  }

  return { post, admitted, challengedIps }
}

describe('visitor refresh procedures', () => {
  test('refuse callers without the internal secret', async () => {
    const harness = createHarness()

    const answer = await harness.post('/players/7/refresh', {}, { 'x-visitor-real-ip': visitorAddress })

    expect(answer.status).toBe(403)
    expect(harness.admitted).toEqual([])
  })

  test('a fresh player needs no refresh and costs the visitor nothing', async () => {
    const harness = createHarness({ lastSuccessAt: freshAt })

    const answer = await harness.post('/players/7/refresh', {})

    expect(answer.body).toEqual({ refresh: { outcome: 'notNeeded', retry: { kind: 'none' } }, refreshTrust: null })
    expect(harness.admitted).toEqual([])
  })

  test('a stale player asks a visitor without trust for the challenge', async () => {
    const harness = createHarness()

    const answer = await harness.post('/players/7/refresh', {})

    expect(answer.body.refresh).toEqual({ outcome: 'verificationRequired', retry: { kind: 'verify' } })
    expect(harness.admitted).toEqual([])
  })

  test('a passed challenge is checked and charged against the visitor, and grants trust', async () => {
    const harness = createHarness()

    const answer = await harness.post('/players/7/refresh', { turnstileToken: 'answer' })

    expect(answer.body.refresh.outcome).toBe('accepted')
    expect(answer.body.refreshTrust).toEqual(expect.any(String))
    expect(harness.challengedIps).toEqual([visitorAddress])
    expect(harness.admitted).toEqual([{ kind: 'verified-anonymous', ip: visitorAddress }])
  })

  test('the granted trust skips the challenge next time', async () => {
    const harness = createHarness()
    const first = await harness.post('/players/7/refresh', { turnstileToken: 'answer' })

    const second = await harness.post('/players/7/refresh', { refreshTrust: first.body.refreshTrust })

    expect(second.body).toMatchObject({ refresh: { outcome: 'accepted' }, refreshTrust: null })
    expect(harness.challengedIps).toHaveLength(1)
  })

  test('a forged trust token still gets the challenge', async () => {
    const harness = createHarness()

    const answer = await harness.post('/players/7/refresh', { refreshTrust: 'v1.1.86401.nonce.forged' })

    expect(answer.body.refresh.outcome).toBe('verificationRequired')
  })

  test('a failed challenge grants no trust', async () => {
    const harness = createHarness({ verification: 'invalid' })

    const answer = await harness.post('/players/7/refresh', { turnstileToken: 'wrong' })

    expect(answer.body).toEqual({
      refresh: { outcome: 'verificationRequired', retry: { kind: 'verify' } },
      refreshTrust: null,
    })
  })

  test('a visitor over the admission limit is refused with the wait', async () => {
    const harness = createHarness({ actor: { outcome: 'rate-limited', retryAfterSeconds: 120 } })

    const answer = await harness.post('/players/7/refresh', { turnstileToken: 'answer' })

    expect(answer.body.refresh).toEqual({ outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 120 } })
  })

  test('a stale guild is refreshed for the visitor', async () => {
    const harness = createHarness()

    const answer = await harness.post('/clans/77/refresh', { turnstileToken: 'answer' })

    expect(answer.body.refresh.outcome).toBe('accepted')
    expect(answer.body.refreshTrust).toEqual(expect.any(String))
    expect(harness.admitted).toEqual([{ kind: 'verified-anonymous', ip: visitorAddress }])
  })

  test('a fresh guild needs no refresh', async () => {
    const harness = createHarness({ lastSuccessAt: freshAt })

    const answer = await harness.post('/clans/77/refresh', {})

    expect(answer.body.refresh.outcome).toBe('notNeeded')
    expect(harness.admitted).toEqual([])
  })

  test('a guild visitor over the admission limit is refused', async () => {
    const harness = createHarness({ actor: { outcome: 'rate-limited', retryAfterSeconds: 60 } })

    const answer = await harness.post('/clans/77/refresh', { turnstileToken: 'answer' })

    expect(answer.body.refresh).toEqual({ outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 60 } })
  })
})
