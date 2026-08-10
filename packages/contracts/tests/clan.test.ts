import { describe, expect, test } from 'bun:test'
import { type ClanProfileContract, clanProfileSchema, clanRefreshResponseSchema } from '../src/clan'

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
})
