import { describe, expect, test } from 'bun:test'
import { parseGuildMembers } from '../domain/guild-members'
import { parseGuildStats } from '../domain/guild-stats'
import { isOlderThanLastSuccess } from '../domain/publication'
import { effectPreparation } from '../domain/refresh-effect'
import { classifySourceFailure } from '../domain/source-failure'

const clanId = 42

const stats = {
  guild_id: clanId,
  name: 'Clan',
  create_date: 1_660_000_000,
  xp: '900719925474099312345',
  legacy_xp: 5,
  notice: '',
  tags: ['eu'],
  discord_invite_code: '',
  guild_points: 0,
  is_recruiting: true,
}

describe('parseGuildStats', () => {
  test('adds legacy xp to current xp without losing digits', () => {
    const profile = parseGuildStats(stats, clanId)

    expect(profile.clanXp).toBe('900719925474099312345')
    expect(profile.clanLifetimeXp).toBe('900719925474099312350')
    expect(profile.clanCreateDate).toEqual(new Date(1_660_000_000_000))
  })

  test('rejects a payload for another guild', () => {
    expect(() => parseGuildStats({ ...stats, guild_id: 7 }, clanId)).toThrow('unexpected guild ID')
  })

  test('rejects a name with nothing visible in it', () => {
    expect(() => parseGuildStats({ ...stats, name: ' \u200B ' }, clanId)).toThrow('guild stats name must be visible')
  })
})

describe('parseGuildMembers', () => {
  test('stores blank and missing details as null', () => {
    const [member] = parseGuildMembers(
      { guild_id: clanId, guild_members: [{ brawlhalla_id: 1, name: ' ', xp: 3 }] },
      clanId,
    )

    expect(member).toEqual({ brawlhallaId: 1, name: null, rank: null, joinDate: null, xp: '3', guildPoints: null })
  })

  test('rejects a roster that lists a player twice', () => {
    const roster = {
      guild_id: clanId,
      guild_members: [
        { brawlhalla_id: 1, xp: 1 },
        { brawlhalla_id: 1, xp: 2 },
      ],
    }

    expect(() => parseGuildMembers(roster, clanId)).toThrow('invalid duplicate player ID')
  })

  test('rejects a roster without a member list', () => {
    expect(() => parseGuildMembers({ guild_id: clanId }, clanId)).toThrow('guild_members must be a complete array')
  })
})

describe('classifySourceFailure', () => {
  test('retries an admission limit and a source rate limit', () => {
    expect(classifySourceFailure({ retryAfterSeconds: 3 })).toEqual({ outcome: 'admission-limited', isRetryable: true })
    expect(classifySourceFailure({ retryAfterMs: 300 })).toEqual({ outcome: 'source-rate-limited', isRetryable: true })
  })

  test('treats any other failure as ambiguous', () => {
    expect(classifySourceFailure(new Error('timeout'))).toEqual({ outcome: 'ambiguous-failure', isRetryable: false })
  })
})

describe('effectPreparation', () => {
  const active = { leaseToken: 2, appliedAt: null, isActive: true }

  test('lets the current lease holder publish once', () => {
    expect(effectPreparation(active, 2)).toBe('execute')
    expect(effectPreparation({ ...active, appliedAt: new Date() }, 2)).toBe('already-applied')
  })

  test('fences a missing, newer, revoked or expired lease', () => {
    expect(effectPreparation(undefined, 2)).toBe('fenced')
    expect(effectPreparation(active, 1)).toBe('fenced')
    expect(effectPreparation({ ...active, isActive: false }, 2)).toBe('fenced')
  })
})

describe('isOlderThanLastSuccess', () => {
  const lastSuccessAt = new Date('2026-08-10T10:00:00.000Z')

  test('is true only when the stored success is newer', () => {
    expect(isOlderThanLastSuccess(new Date('2026-08-10T09:00:00.000Z'), lastSuccessAt)).toBe(true)
    expect(isOlderThanLastSuccess(lastSuccessAt, lastSuccessAt)).toBe(false)
    expect(isOlderThanLastSuccess(new Date('2026-08-10T09:00:00.000Z'), null)).toBe(false)
  })
})
