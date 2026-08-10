import { describe, expect, test } from 'bun:test'
import { createClanRouter } from '../src/router/clan.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'clan-router-test-secret'
const cached = {
  clanId: 77,
  clanName: 'Cached',
  clanCreateDate: new Date('2026-01-01T00:00:00.000Z'),
  clanXp: '900719925474099312345',
  clanLifetimeXp: '1801439850948198711110',
  notice: '',
  tags: [],
  discordInviteCode: '',
  guildPoints: '0',
  isRecruiting: false,
  profile: {
    checkedAt: new Date(),
    checkProvenance: { source: 'v1-guild-stats', outcome: 'success' },
    lastSuccessAt: new Date(0),
    lastSuccessProvenance: { source: 'v1-guild-stats', outcome: 'success' },
  },
  roster: {
    checkedAt: new Date(),
    checkProvenance: { source: 'v1-guild-members', outcome: 'success' },
    lastSuccessAt: new Date(0),
    lastSuccessProvenance: { source: 'v1-guild-members', outcome: 'success' },
  },
  members: [],
} as const

function harness(options: { trusted?: boolean; actorLimited?: boolean; active?: boolean } = {}) {
  const operationId = crypto.randomUUID()
  const calls = { reserve: 0, actor: 0, actorKind: '' }
  const context = {
    internalSecret: secret,
    clientIp: '203.0.113.1',
    user: null,
    clanRepo: { getById: async () => cached },
    refreshOperations: {
      findActiveInteractiveClanRefresh: async () =>
        options.active ? { operationId, awaitingAdmission: false, reservationExpired: false } : null,
      reserveInteractiveClanRefresh: async () => {
        calls.reserve++
        return { outcome: 'reserved', operationId, reservationToken: crypto.randomUUID() } as const
      },
      activateInteractiveRefresh: async () => 'transitioned' as const,
      rejectInteractiveRefresh: async () => 'transitioned' as const,
    },
    requestAdmission: {
      admitActor: async (actor: { kind: string }) => {
        calls.actor++
        calls.actorKind = actor.kind
        return options.actorLimited
          ? ({ outcome: 'rate-limited', retryAfterSeconds: 12 } as const)
          : ({ outcome: 'admitted' } as const)
      },
      hasActorReservation: async () => false,
    },
    refreshTrust: { trusted: options.trusted ?? false, grant() {} },
    verifyRefreshChallenge: async () => 'invalid' as const,
  } as unknown as Context
  return { caller: createClanRouter(createInternalProcedure(secret)).createCaller(context), calls, operationId }
}

describe('canonical clan router', () => {
  test('maps exact strings and independent section state', async () => {
    const { caller } = harness()
    await expect(caller.byId({ id: 77 })).resolves.toMatchObject({
      clanId: 77,
      clanXp: '900719925474099312345',
      profile: { lastSuccessAt: '1970-01-01T00:00:00.000Z' },
      roster: { lastSuccessAt: '1970-01-01T00:00:00.000Z' },
    })
  })

  test('deduplicates before verification and preserves cached data in blocked outcomes', async () => {
    const active = harness({ active: true })
    await expect(active.caller.refresh({ id: 77 })).resolves.toMatchObject({
      clan: { clanId: 77 },
      refresh: { outcome: 'alreadyRefreshing', operationId: active.operationId },
    })
    expect(active.calls).toEqual({ reserve: 0, actor: 0, actorKind: '' })

    const limited = harness({ trusted: true, actorLimited: true })
    await expect(limited.caller.refresh({ id: 77 })).resolves.toMatchObject({
      clan: { clanId: 77 },
      refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 12 } },
    })
  })

  test('separates trusted Discord identity from the web refresh input', async () => {
    const web = harness({ trusted: true })
    await expect(web.caller.refresh({ id: 77, discordUserId: 'spoofed' } as never)).rejects.toThrow()

    const discord = harness()
    await discord.caller.refreshDiscord({ id: 77, discordUserId: 'trusted-discord-user' })
    expect(discord.calls.actorKind).toBe('discord')
  })
})
