import { describe, expect, test } from 'bun:test'
import type { PlayerReferenceQueries } from '@brawltome/player'
import type { InteractiveRefreshOperations } from '@brawltome/refresh-operations'
import type { ActorAdmissionResult, SourceAdmissionResult } from '@brawltome/request-admission'
import { createCanonicalPlayerRefreshRouter, createV2PlayerRefreshRouter } from '../src/router/player.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'player-refresh-test-secret'
const cached = { brawlhallaId: 42, name: 'Cached Ada' }
const stalePlayer = { rankedLastUpdated: null, statsLastUpdated: null }

function harness(
  options: {
    player?: unknown
    activeOperationId?: string
    activeAwaiting?: boolean
    actorReserved?: boolean
    actor?: ActorAdmissionResult
    source?: SourceAdmissionResult
    verification?: 'valid' | 'invalid' | 'unavailable'
    authenticated?: boolean
    trusted?: boolean
    rankedLastSuccess?: Date | null
  } = {},
) {
  const calls = { verify: 0, actor: 0, source: 0, reserve: 0, activate: 0, grant: 0 }
  const operationId = crypto.randomUUID()
  const playerReferenceQueries: PlayerReferenceQueries = { byId: async () => cached }
  const operations: InteractiveRefreshOperations = {
    findActiveInteractivePlayerRefresh: async () =>
      options.activeOperationId
        ? {
            operationId: options.activeOperationId,
            awaitingAdmission: options.activeAwaiting ?? false,
            reservationExpired: options.activeAwaiting ?? false,
          }
        : null,
    reserveInteractivePlayerRefresh: async () => {
      calls.reserve++
      return { outcome: 'reserved', operationId, reservationToken: crypto.randomUUID() }
    },
    activateInteractiveRefresh: async () => {
      calls.activate++
      return 'transitioned'
    },
    activateAdmittedInteractiveRefresh: async () => {
      calls.activate++
      return 'transitioned'
    },
    rejectInteractiveRefresh: async () => 'transitioned',
    rejectExpiredInteractiveRefresh: async () => 'transitioned',
  }
  const context = {
    internalSecret: secret,
    clientIp: '203.0.113.42',
    account: options.authenticated
      ? { id: 'account-42', displayName: 'Ada', avatarUrl: null, createdAt: new Date('2026-01-01T00:00:00.000Z') }
      : null,
    playerReferenceQueries,
    rankedPlayerQueries: {
      byId: async () => {
        if ('rankedLastSuccess' in options) {
          return options.rankedLastSuccess ? { lastSuccessAt: options.rankedLastSuccess } : null
        }
        const stored = options.player === undefined ? stalePlayer : options.player
        if (!stored || typeof stored !== 'object' || !('rankedLastUpdated' in stored) || !stored.rankedLastUpdated) {
          return null
        }
        return { lastSuccessAt: stored.rankedLastUpdated }
      },
    },
    playerRepo: { findById: async () => (options.player === undefined ? stalePlayer : options.player) },
    refreshOperations: operations,
    requestAdmission: {
      admitActor: async () => {
        calls.actor++
        return options.actor ?? { outcome: 'admitted' }
      },
      hasActorReservation: async () => options.actorReserved ?? false,
      admitSource: async () => {
        calls.source++
        return options.source ?? { outcome: 'admitted', deduplicated: false }
      },
    },
    refreshTrust: {
      trusted: options.trusted ?? false,
      grant: () => calls.grant++,
    },
    verifyRefreshChallenge: async () => {
      calls.verify++
      return options.verification ?? 'invalid'
    },
  } as unknown as Context
  return { context, calls, operationId }
}

function caller(options: Parameters<typeof harness>[0] = {}) {
  const result = harness(options)
  const procedure = createInternalProcedure(secret)
  return {
    ...result,
    canonical: createCanonicalPlayerRefreshRouter(procedure).createCaller(result.context),
    v2: createV2PlayerRefreshRouter(procedure).createCaller(result.context),
  }
}

describe('canonical player interactive refresh', () => {
  test('returns notNeeded with cache before verification or source admission', async () => {
    const { canonical, calls } = caller({
      player: { rankedLastUpdated: new Date(), statsLastUpdated: new Date() },
    })
    await expect(canonical.requestRefresh({ id: 42 })).resolves.toEqual({
      player: cached,
      refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
    })
    expect(calls).toEqual({ verify: 0, actor: 0, source: 0, reserve: 0, activate: 0, grant: 0 })
  })

  test('uses canonical last-success rather than checked-at or legacy ranked timestamps for freshness', async () => {
    const freshStats = { rankedLastUpdated: new Date(), statsLastUpdated: new Date() }
    const stale = caller({ player: freshStats, rankedLastSuccess: null, trusted: true })
    await expect(stale.canonical.requestRefresh({ id: 42 })).resolves.toMatchObject({
      refresh: { outcome: 'accepted' },
    })
    expect(stale.calls.reserve).toBe(1)

    const fresh = caller({
      player: { rankedLastUpdated: null, statsLastUpdated: new Date() },
      rankedLastSuccess: new Date(),
    })
    await expect(fresh.canonical.requestRefresh({ id: 42 })).resolves.toMatchObject({
      refresh: { outcome: 'notNeeded' },
    })
    expect(fresh.calls.reserve).toBe(0)
  })

  test('returns alreadyRefreshing before verification or source admission', async () => {
    const activeOperationId = crypto.randomUUID()
    const { canonical, calls } = caller({ activeOperationId })
    await expect(canonical.requestRefresh({ id: 42 })).resolves.toEqual({
      player: cached,
      refresh: {
        outcome: 'alreadyRefreshing',
        operationId: activeOperationId,
        retry: { kind: 'poll', afterSeconds: 2 },
      },
    })
    expect(calls.source).toBe(0)
    expect(calls.verify).toBe(0)
  })

  test('reconciles actor-admitted work after an activation crash without charging again', async () => {
    const activeOperationId = crypto.randomUUID()
    const { canonical, calls } = caller({ activeOperationId, activeAwaiting: true, actorReserved: true })
    await expect(canonical.requestRefresh({ id: 42 })).resolves.toMatchObject({
      player: cached,
      refresh: { outcome: 'alreadyRefreshing', operationId: activeOperationId },
    })
    expect(calls.activate).toBe(1)
    expect(calls.actor).toBe(0)
    expect(calls.source).toBe(0)
  })

  test('returns verificationRequired, rateLimited, and temporarilyUnavailable with unchanged cache', async () => {
    const verification = caller({ verification: 'invalid' })
    await expect(verification.canonical.requestRefresh({ id: 42 })).resolves.toEqual({
      player: cached,
      refresh: { outcome: 'verificationRequired', retry: { kind: 'verify' } },
    })

    const limited = caller({ verification: 'valid', actor: { outcome: 'rate-limited', retryAfterSeconds: 77 } })
    await expect(limited.canonical.requestRefresh({ id: 42, turnstileToken: 'valid-token' })).resolves.toEqual({
      player: cached,
      refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 77 } },
    })
    expect(limited.calls.source).toBe(0)
    expect(limited.calls.grant).toBe(1)

    const unavailable = caller({ verification: 'unavailable' })
    await expect(unavailable.canonical.requestRefresh({ id: 42, turnstileToken: 'token' })).resolves.toEqual({
      player: cached,
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
    })
  })

  test('authenticated and trusted callers bypass verification without rolling trust', async () => {
    for (const options of [{ authenticated: true }, { trusted: true }]) {
      const { canonical, calls, operationId } = caller(options)
      await expect(canonical.requestRefresh({ id: 42 })).resolves.toEqual({
        player: cached,
        refresh: { outcome: 'accepted', operationId, retry: { kind: 'poll', afterSeconds: 2 } },
      })
      expect(calls.verify).toBe(0)
      expect(calls.grant).toBe(0)
      expect(calls.source).toBe(0)
    }
  })

  test('keeps the V2 input/output usable while mapping canonical polling outcomes', async () => {
    const accepted = caller({ authenticated: true })
    await expect(accepted.v2.refresh({ id: 42, turnstileToken: '' })).resolves.toEqual({ isRefreshing: true })

    const blocked = caller({ verification: 'invalid' })
    await expect(blocked.v2.refresh({ id: 42, turnstileToken: 'bad' })).resolves.toEqual({ isRefreshing: false })
  })
})
