import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { MatchDetailContract, MatchInsights } from '@brawltome/contracts'

// the match page's fixtures: insights the match-insights module worked out from four anonymised lines, and the
// playback timelines the replays module trimmed from two of them. both modules have tests that fail when these go stale

export type InsightsFixture = 'duel-a' | 'duel-b' | 'doubles-a' | 'doubles-b'
export type PlaybackFixture = 'duel-a' | 'doubles-b'

const fixtureFolder = resolve(import.meta.dir, 'fixtures')

export function readInsights(name: InsightsFixture): MatchInsights {
  return JSON.parse(readFileSync(resolve(fixtureFolder, `${name}.insights.json`), 'utf8')) as MatchInsights
}

/** The timeline as the site serves it, before the page reads it. */
export function readPlayback(name: PlaybackFixture): unknown {
  return JSON.parse(gunzipSync(readFileSync(resolve(fixtureFolder, `${name}.playback.json.gz`))).toString('utf8'))
}

/** A match detail around a fixture's insights, as the api would send it. */
export function matchDetailOf(name: InsightsFixture, art: MatchDetailContract['art']): MatchDetailContract {
  const insights = readInsights(name)
  const { summary } = insights

  return {
    id: '6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f',
    patch: summary.patch,
    mapName: summary.mapName,
    modeName: summary.modeName,
    isRanked: true,
    isCustom: false,
    durationMs: summary.durationMs,
    parsedAt: '2026-11-13T20:00:00.000Z',
    mapPictureUrl: null,
    queue: 'ranked',
    hasTeams: summary.players.length > 2,
    hasTeamDamage: false,
    stocks: 3,
    isReliable: true,
    failedChecks: [],
    players: [],
    replay: { available: true, patch: summary.patch, fileName: 'match.replay' },
    insights,
    art,
    playbackPath: '/match/6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f/playback/main-1/1',
  }
}
