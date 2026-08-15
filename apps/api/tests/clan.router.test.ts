import { describe, expect, test } from 'bun:test'
import { createClanRouter } from '../src/router/clan.router'
import type { Context } from '../src/trpc/context'
import { createDiscordBotProcedure, createInternalProcedure } from '../src/trpc/trpc'

const secret = 'clan-router-test-secret'
const discordSecret = 'discord-clan-router-test-secret'
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

function harness(
  options: {
    trusted?: boolean
    actorLimited?: boolean
    active?: boolean
    stored?: typeof cached
    membership?: { clanId: number; clanName: string } | null
    discordCredential?: boolean
    now?: () => number
  } = {},
) {
  const operationId = crypto.randomUUID()
  const calls = { reserve: 0, actor: 0, actorKind: '' }
  let activeDedupeKey = ''
  let reservedDedupeKey = ''
  const context = {
    internalSecret: secret,
    discordInternalSecret: options.discordCredential === false ? undefined : discordSecret,
    clientIp: '203.0.113.1',
    user: null,
    clanRepo: {
      getById: async () => options.stored ?? cached,
      getPlayerMembership: async () => options.membership ?? null,
    },
    refreshOperations: {
      findActiveInteractiveClanRefresh: async (dedupeKey: string) => {
        activeDedupeKey = dedupeKey
        return options.active ? { operationId, awaitingAdmission: false, reservationExpired: false } : null
      },
      reserveInteractiveClanRefresh: async (input: { dedupeKey: string }) => {
        calls.reserve++
        reservedDedupeKey = input.dedupeKey
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
  return {
    caller: createClanRouter(
      createInternalProcedure(secret),
      createDiscordBotProcedure(secret, discordSecret),
      options.now,
    ).createCaller(context),
    calls,
    operationId,
    activeDedupeKey: () => activeDedupeKey,
    reservedDedupeKey: () => reservedDedupeKey,
  }
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

  test('publishes Clans-owned membership by Player identity', async () => {
    const { caller } = harness({ membership: { clanId: 77, clanName: 'Current Clan' } })
    await expect(caller.membershipByPlayerId({ id: 42 })).resolves.toEqual({
      clanId: 77,
      clanName: 'Current Clan',
    })
  })

  test('keeps immutable migration evidence behind the public provenance boundary', async () => {
    const stored = {
      ...cached,
      profile: {
        ...cached.profile,
        checkProvenance: {
          ...cached.profile.checkProvenance,
          sourceTable: 'clan',
          sourceKey: '77',
          archiveChecksum: 'a'.repeat(64),
        },
      },
      roster: {
        ...cached.roster,
        checkProvenance: {
          ...cached.roster.checkProvenance,
          sourceTables: ['clan_member', 'player_clan'],
          archiveChecksums: ['b'.repeat(64)],
        },
      },
    } as typeof cached
    const { caller } = harness({ stored })
    const result = await caller.byId({ id: 77 })
    expect(result?.profile.checkProvenance).toEqual({ source: 'v1-guild-stats', outcome: 'success' })
    expect(result?.roster?.checkProvenance).toEqual({ source: 'v1-guild-members', outcome: 'success' })
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

  test('changes dedupe identity when another clan section becomes stale without changing stored timestamps', async () => {
    const profileSuccess = new Date('2026-08-10T00:00:00.000Z')
    const rosterSuccess = new Date('2026-08-10T01:00:00.000Z')
    const stored = {
      ...cached,
      profile: { ...cached.profile, lastSuccessAt: profileSuccess },
      roster: { ...cached.roster, lastSuccessAt: rosterSuccess },
    }
    const profileOnly = harness({
      trusted: true,
      stored,
      now: () => Date.parse('2026-08-10T01:30:00.000Z'),
    })
    await profileOnly.caller.refresh({ id: 77 })

    const profileAndRoster = harness({
      trusted: true,
      stored,
      now: () => Date.parse('2026-08-10T02:30:00.000Z'),
    })
    await profileAndRoster.caller.refresh({ id: 77 })

    expect(profileOnly.activeDedupeKey()).toBe(profileOnly.reservedDedupeKey())
    expect(profileAndRoster.activeDedupeKey()).toBe(profileAndRoster.reservedDedupeKey())
    expect(profileOnly.reservedDedupeKey()).not.toBe(profileAndRoster.reservedDedupeKey())
  })

  test('separates trusted Discord identity from the web refresh input and generic internal callers', async () => {
    const web = harness({ trusted: true })
    await expect(web.caller.refresh({ id: 77, discordUserId: 'spoofed' } as never)).rejects.toThrow()

    const genericInternalCaller = harness({ discordCredential: false })
    await expect(
      genericInternalCaller.caller.refreshDiscord({ id: 77, discordUserId: '123456789012345678' }),
    ).rejects.toThrow('Access denied')

    const discord = harness()
    await discord.caller.refreshDiscord({ id: 77, discordUserId: '123456789012345678' })
    expect(discord.calls.actorKind).toBe('discord')
  })
})
