import { describe, expect, test } from 'bun:test'
import type { ClanProfileContract } from '@brawltome/contracts'
import { isGuildRefreshed, isGuildStale, isPlayerRefreshed, isPlayerStale } from '../src/components/refresh/staleness'
import type { PlayerData } from '../src/server/load-player'

const now = new Date('2026-11-09T12:00:00.000Z')
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

type Freshness = 'fresh' | 'stale' | 'unavailable'

function player(ranked: Freshness | null, career: Freshness | null, lastSuccessAt = minutesAgo(600)): PlayerData {
  const section = (freshness: Freshness) => ({
    freshness,
    lastSuccessAt: freshness === 'unavailable' ? null : lastSuccessAt,
  })

  return {
    brawlhallaId: 7,
    name: 'Seven',
    aliases: [],
    clan: null,
    bestLegendNameKey: null,
    currentSeason: ranked ? section(ranked) : null,
    career: career ? { ...section(career), snapshotSource: 'v0-player-snapshot' } : null,
  } as unknown as PlayerData
}

function guild(profileAt: string | null, rosterAt: string | null): ClanProfileContract {
  const section = (lastSuccessAt: string | null) => ({ lastSuccessAt })

  return { profile: section(profileAt), roster: section(rosterAt) } as unknown as ClanProfileContract
}

describe('player staleness', () => {
  test('a fresh player needs no refresh', () => {
    expect(isPlayerStale(player('fresh', 'fresh'))).toBe(false)
  })

  test('a stale or missing section needs one', () => {
    expect(isPlayerStale(player('stale', 'fresh'))).toBe(true)
    expect(isPlayerStale(player('fresh', 'unavailable'))).toBe(true)
    expect(isPlayerStale(player(null, null))).toBe(true)
  })

  test('is refreshed once every stale section has a newer success', () => {
    const before = player('stale', 'fresh', minutesAgo(600))
    const rankedOnly = { ...before, currentSeason: player('fresh', 'fresh', minutesAgo(0)).currentSeason }

    expect(isPlayerRefreshed(before, before)).toBe(false)
    expect(isPlayerRefreshed(before, rankedOnly)).toBe(true)
  })

  test('a missing section is refreshed once it has any success', () => {
    const before = player(null, null)

    expect(isPlayerRefreshed(before, player('fresh', 'fresh', minutesAgo(0)))).toBe(true)
    expect(isPlayerRefreshed(before, { ...before, currentSeason: player('fresh', null).currentSeason })).toBe(false)
  })
})

describe('guild staleness', () => {
  test('a guild read within the hour needs no refresh', () => {
    expect(isGuildStale(guild(minutesAgo(10), minutesAgo(59)), now)).toBe(false)
  })

  test('an old or missing section needs one', () => {
    expect(isGuildStale(guild(minutesAgo(61), minutesAgo(10)), now)).toBe(true)
    expect(isGuildStale(guild(minutesAgo(10), null), now)).toBe(true)
  })

  test('is refreshed once every stale section has a newer success', () => {
    const before = guild(minutesAgo(120), minutesAgo(10))

    expect(isGuildRefreshed(before, before, now)).toBe(false)
    expect(isGuildRefreshed(before, guild(minutesAgo(0), minutesAgo(10)), now)).toBe(true)
  })
})
