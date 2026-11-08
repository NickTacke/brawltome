import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { clanModule, createPostgresClans } from '@brawltome/clan'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createClanRouter } from '../src/router/clan.router'
import type { Context } from '../src/trpc/context'
import { createDiscordBotProcedure, createInternalProcedure } from '../src/trpc/trpc'
import {
  completeClan,
  identityOnlyClan,
  legacyClan,
  plainClan,
  plainClanResponse,
  profileOnlyClan,
  seedClan,
  sparseMembersClan,
  unpublishedProfileClan,
} from './fixtures/clans'

const secret = 'clan-router-postgres-test-secret'
const discordSecret = 'discord-clan-router-postgres-test-secret'
const now = Date.parse('2026-08-10T12:00:00.000Z')
const oneHourMs = 60 * 60 * 1_000
const unknownClanId = 999_999

// these clans exist only for the stale and fresh refresh cases
const freshAt = new Date(now - oneHourMs + 1)
const boundaryAt = new Date(now - oneHourMs)
const justStaleAt = new Date(now - oneHourMs - 1)
const freshClan = plainClan(201, 'Fresh Clan', freshAt, freshAt)
const boundaryClan = plainClan(202, 'Boundary Clan', boundaryAt, boundaryAt)
const rosterStaleClan = plainClan(203, 'Roster Stale', boundaryAt, justStaleAt)
const profileStaleClan = plainClan(204, 'Profile Stale', justStaleAt, boundaryAt)

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'clan_router', modules: [clanModule] })

  const scenarios = [
    completeClan,
    legacyClan,
    sparseMembersClan,
    profileOnlyClan,
    identityOnlyClan,
    unpublishedProfileClan,
  ]

  for (const scenario of scenarios) await seedClan(database, scenario.clan)

  for (const clan of [freshClan, boundaryClan, rosterStaleClan, profileStaleClan]) await seedClan(database, clan)
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

function createCaller() {
  const operationId = crypto.randomUUID()
  const reservations: { dedupeKey: string; clanId: number; staleSections: string[] }[] = []

  const context = {
    internalSecret: secret,
    discordInternalSecret: discordSecret,
    clientIp: '203.0.113.1',
    user: null,
    clanRepo: createPostgresClans(database),
    refreshOperations: {
      findActiveInteractiveClanRefresh: async () => null,
      reserveInteractiveClanRefresh: async (input: { dedupeKey: string; clanId: number; staleSections: string[] }) => {
        reservations.push({ dedupeKey: input.dedupeKey, clanId: input.clanId, staleSections: input.staleSections })

        return { outcome: 'reserved', operationId, reservationToken: crypto.randomUUID() } as const
      },
      activateInteractiveRefresh: async () => 'transitioned' as const,
      rejectInteractiveRefresh: async () => 'transitioned' as const,
    },
    requestAdmission: {
      admitActor: async () => ({ outcome: 'admitted' }) as const,
      hasActorReservation: async () => false,
    },
    refreshTrust: { trusted: true, grant() {} },
    verifyRefreshChallenge: async () => 'invalid' as const,
  } as unknown as Context

  const router = createClanRouter(
    createInternalProcedure(secret),
    createDiscordBotProcedure(secret, discordSecret),
    () => now,
  )

  return { caller: router.createCaller(context), operationId, reservations }
}

function accepted(operationId: string) {
  return { outcome: 'accepted', operationId, retry: { kind: 'poll', afterSeconds: 2 } } as const
}

describe('clan.byId over the clan tables', () => {
  test('returns every field of a fully fetched clan, members ordered by xp as text then player id', async () => {
    const { caller } = createCaller()

    await expect(caller.byId({ id: completeClan.clan.clanId })).resolves.toEqual(completeClan.expected)
  })

  test('returns null for a clan that was never stored', async () => {
    const { caller } = createCaller()

    await expect(caller.byId({ id: unknownClanId })).resolves.toBeNull()
  })

  test('returns null for a clan identity that was never fetched', async () => {
    const { caller } = createCaller()

    await expect(caller.byId({ id: identityOnlyClan.clan.clanId })).resolves.toBeNull()
  })

  test('returns null when only the checks and members exist without a profile', async () => {
    const { caller } = createCaller()

    await expect(caller.byId({ id: unpublishedProfileClan.clan.clanId })).resolves.toBeNull()
  })

  test('returns null sections and nullable fields for an imported clan', async () => {
    const { caller } = createCaller()

    await expect(caller.byId({ id: legacyClan.clan.clanId })).resolves.toEqual(legacyClan.expected)
  })

  test('returns members with missing details and breaks xp ties by player id', async () => {
    const { caller } = createCaller()

    await expect(caller.byId({ id: sparseMembersClan.clan.clanId })).resolves.toEqual(sparseMembersClan.expected)
  })

  test('returns a null roster for a clan whose roster was never checked', async () => {
    const { caller } = createCaller()

    await expect(caller.byId({ id: profileOnlyClan.clan.clanId })).resolves.toEqual(profileOnlyClan.expected)
  })
})

describe('clan.membershipByPlayerId over the clan tables', () => {
  test('returns the clan id and name of the clan the player belongs to', async () => {
    const { caller } = createCaller()

    await expect(caller.membershipByPlayerId({ id: 30 })).resolves.toEqual({ clanId: 101, clanName: 'Complete Clan' })
  })

  test('returns null for a player that is in no clan', async () => {
    const { caller } = createCaller()

    await expect(caller.membershipByPlayerId({ id: 8_888_888 })).resolves.toBeNull()
  })

  test('returns null for a member of a clan that has no profile', async () => {
    const { caller } = createCaller()

    await expect(caller.membershipByPlayerId({ id: 61 })).resolves.toBeNull()
  })
})

describe('clan.refresh over the clan tables', () => {
  test('does not refresh a clan whose sections were both fetched within the hour', async () => {
    const { caller, reservations } = createCaller()

    await expect(caller.refresh({ id: 201 })).resolves.toEqual({
      clan: plainClanResponse(201, 'Fresh Clan', freshAt, freshAt),
      refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
    })

    expect(reservations).toEqual([])
  })

  test('treats a section fetched exactly one hour ago as fresh', async () => {
    const { caller, reservations } = createCaller()

    await expect(caller.refresh({ id: 202 })).resolves.toEqual({
      clan: plainClanResponse(202, 'Boundary Clan', boundaryAt, boundaryAt),
      refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
    })

    expect(reservations).toEqual([])
  })

  test('refreshes only the roster when only the roster is older than an hour', async () => {
    const { caller, operationId, reservations } = createCaller()

    await expect(caller.refresh({ id: 203 })).resolves.toEqual({
      clan: plainClanResponse(203, 'Roster Stale', boundaryAt, justStaleAt),
      refresh: accepted(operationId),
    })

    expect(reservations).toEqual([
      {
        dedupeKey: `clan:203:profile:${boundaryAt.getTime()}:roster:${justStaleAt.getTime()}:sections:roster`,
        clanId: 203,
        staleSections: ['roster'],
      },
    ])
  })

  test('refreshes only the profile when only the profile is older than an hour', async () => {
    const { caller, operationId, reservations } = createCaller()

    await expect(caller.refresh({ id: 204 })).resolves.toEqual({
      clan: plainClanResponse(204, 'Profile Stale', justStaleAt, boundaryAt),
      refresh: accepted(operationId),
    })

    expect(reservations).toEqual([
      {
        dedupeKey: `clan:204:profile:${justStaleAt.getTime()}:roster:${boundaryAt.getTime()}:sections:profile`,
        clanId: 204,
        staleSections: ['profile'],
      },
    ])
  })

  test('refreshes the roster of a clan whose roster was never fetched', async () => {
    const { caller, operationId, reservations } = createCaller()

    await expect(caller.refresh({ id: 104 })).resolves.toEqual({
      clan: profileOnlyClan.expected,
      refresh: accepted(operationId),
    })

    expect(reservations).toEqual([
      {
        dedupeKey: `clan:104:profile:${Date.parse('2026-08-10T11:30:00.000Z')}:roster:0:sections:roster`,
        clanId: 104,
        staleSections: ['roster'],
      },
    ])
  })

  test('refreshes both sections and returns a null clan for a clan never stored', async () => {
    const { caller, operationId, reservations } = createCaller()

    await expect(caller.refresh({ id: unknownClanId })).resolves.toEqual({
      clan: null,
      refresh: accepted(operationId),
    })

    expect(reservations).toEqual([
      {
        dedupeKey: `clan:${unknownClanId}:profile:0:roster:0:sections:profile,roster`,
        clanId: unknownClanId,
        staleSections: ['profile', 'roster'],
      },
    ])
  })

  test('refreshes both sections of a clan identity that was never fetched', async () => {
    const { caller, operationId, reservations } = createCaller()

    await expect(caller.refresh({ id: identityOnlyClan.clan.clanId })).resolves.toEqual({
      clan: null,
      refresh: accepted(operationId),
    })

    expect(reservations.map((reservation) => reservation.staleSections)).toEqual([['profile', 'roster']])
  })

  test('returns the stored clan with the refresh outcome while only the profile is stale', async () => {
    const { caller, operationId } = createCaller()

    await expect(caller.refresh({ id: completeClan.clan.clanId })).resolves.toEqual({
      clan: completeClan.expected,
      refresh: accepted(operationId),
    })
  })
})
