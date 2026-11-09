import { describe, expect, test } from 'bun:test'
import {
  type ClanProfileContract,
  clanProfileSchema,
  clanRefreshResponseSchema,
  clanStandingSchema,
  playerClanMembershipSchema,
  rankedClanListInputSchema,
  rankedClanListSchema,
} from '../src/clan'

const profile = {
  clanId: 77,
  clanName: 'Exact',
  clanCreateDate: '2026-08-09T12:00:00.000Z',
  clanXp: '900719925474099312345',
  clanLifetimeXp: '1801439850948198711110',
  notice: null,
  tags: null,
  discordInviteCode: null,
  guildPoints: null,
  isRecruiting: null,
  profile: {
    checkedAt: null,
    checkProvenance: {
      source: 'legacy-import',
      outcome: 'legacy-unknown',
      legacyTimestamp: '2026-08-01T00:00:00.000Z',
    },
    lastSuccessAt: null,
    lastSuccessProvenance: null,
  },
  roster: null,
  members: [],
} satisfies ClanProfileContract

describe('canonical Clan contract', () => {
  test('preserves decimal XP and conservative legacy provenance', () => {
    expect(clanProfileSchema.parse(profile)).toEqual(profile)
  })

  test('represents unavailable member metadata as null', () => {
    const member = {
      brawlhallaId: 42,
      name: null,
      rank: null,
      joinDate: null,
      xp: '123',
      guildPoints: null,
    }

    expect(clanProfileSchema.parse({ ...profile, members: [member] }).members).toEqual([member])
  })

  test('allows a 41-digit derived lifetime while rejecting unsafe numeric XP', () => {
    expect(
      clanProfileSchema.parse({ ...profile, clanLifetimeXp: '19999999999999999999999999999999999999999' })
        .clanLifetimeXp,
    ).toHaveLength(41)

    expect(() => clanProfileSchema.parse({ ...profile, clanXp: Number.MAX_SAFE_INTEGER + 1 })).toThrow()

    expect(
      clanRefreshResponseSchema.parse({
        clan: profile,
        refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 15 } },
      }).clan,
    ).toEqual(profile)
  })

  test('publishes a narrow Clans-owned membership', () => {
    expect(playerClanMembershipSchema.parse({ clanId: 77, clanName: 'Exact' })).toEqual({
      clanId: 77,
      clanName: 'Exact',
    })
  })
})

describe('clan standing contract', () => {
  test('accepts two ranks, or null for a rank the clan has no value for', () => {
    const standing = { guildPointsRank: 3, lifetimeXpRank: 1, lastWeekPoints: '1250', lastWeekRank: 2 }

    expect(clanStandingSchema.parse(standing)).toEqual(standing)

    const unranked = { guildPointsRank: null, lifetimeXpRank: 1, lastWeekPoints: null, lastWeekRank: null }

    expect(clanStandingSchema.parse(unranked)).toEqual(unranked)
  })

  test('rejects a rank below 1, a fractional rank, negative points and an unknown field', () => {
    const standing = { guildPointsRank: 1, lifetimeXpRank: 1, lastWeekPoints: '0', lastWeekRank: 1 }

    expect(() => clanStandingSchema.parse({ ...standing, guildPointsRank: 0 })).toThrow()
    expect(() => clanStandingSchema.parse({ ...standing, lastWeekRank: 1.5 })).toThrow()
    expect(() => clanStandingSchema.parse({ ...standing, lastWeekPoints: '-5' })).toThrow()
    expect(() => clanStandingSchema.parse({ ...standing, extra: true })).toThrow()
  })
})

describe('ranked clan list contract', () => {
  const entry = {
    rank: 1,
    clanId: 77,
    clanName: 'Exact',
    guildPoints: '900719925474099312345',
    lifetimeXp: '1801439850948198711110',
    memberCount: 3,
  }

  const list = { page: 1, pageSize: 30, hasMore: false, totalRows: 1, entries: [entry] }

  test('accepts a page of entries, and a guild with no guild points or rank', () => {
    expect(rankedClanListSchema.parse(list)).toEqual(list)

    const unranked = { ...entry, rank: null, guildPoints: null }

    expect(rankedClanListSchema.parse({ ...list, entries: [unranked] }).entries[0]).toEqual(unranked)
  })

  test('accepts an empty list', () => {
    const empty = { page: 1, pageSize: 30, hasMore: false, totalRows: 0, entries: [] }

    expect(rankedClanListSchema.parse(empty)).toEqual(empty)
  })

  test('rejects a negative member count and an unknown field', () => {
    expect(() => rankedClanListSchema.parse({ ...list, entries: [{ ...entry, memberCount: -1 }] })).toThrow()
    expect(() => rankedClanListSchema.parse({ ...list, entries: [{ ...entry, extra: true }] })).toThrow()
  })

  test('takes a page from 1 up, and no other input', () => {
    expect(rankedClanListInputSchema.parse({ page: 2 })).toEqual({ page: 2 })
    expect(() => rankedClanListInputSchema.parse({ page: 0 })).toThrow()
    expect(() => rankedClanListInputSchema.parse({ page: 1.5 })).toThrow()
    expect(() => rankedClanListInputSchema.parse({ page: 1, pageSize: 100 })).toThrow()
  })
})
