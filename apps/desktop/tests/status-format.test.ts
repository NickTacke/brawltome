import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { AppStatus, RecentMatch } from '../ui/window/app-status'
import { todayResults } from '../ui/window/standing-format'
import { type StatusLine, shortGameVersion, statusLines, timeAgo } from '../ui/window/status-format'

function fixture(name: string): AppStatus {
  const file = path.join(import.meta.dir, 'fixtures', `app-status-${name}.json`)

  return JSON.parse(readFileSync(file, 'utf8'))
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

function recentMatch(startedAtMs: number, isWin: boolean | null, ratingChange: number | null): RecentMatch {
  return {
    startedAtMs,
    opponents: [{ brawlhallaId: 91913839, name: 'Shinigami', legend: 'Hattori' }],
    isWin,
    ratingChange,
  }
}

describe('status lines', () => {
  test('a running, supported game reads ready with its short version', () => {
    expect(statusLines(fixture('ready'))).toEqual([
      { tone: 'ok', text: 'Ready', detail: 'Brawlhalla 11.00', action: null },
    ])
  })

  test('a closed game and a game still connecting are quiet', () => {
    const connecting: AppStatus = {
      ...fixture('idle'),
      game: { state: 'running', gameVersion: null },
      detection: { state: 'starting' },
    }

    expect(statusLines(fixture('idle'))).toEqual([
      { tone: 'idle', text: "Brawlhalla isn't running", detail: null, action: null },
    ])

    expect(statusLines(connecting)).toEqual([
      { tone: 'idle', text: 'Connecting to Brawlhalla', detail: null, action: null },
    ])
  })

  test('an unsupported patch is a warning in the detection line', () => {
    expect(statusLines(fixture('unsupported'))).toEqual([
      { tone: 'warn', text: "Patch 11.01 isn't supported yet", detail: null, action: null },
    ])
  })

  test('trouble with the service gets its own line and only then', () => {
    const ready = fixture('ready')

    const cases: [AppStatus['service'], string | null, string | null][] = [
      [{ state: 'ok' }, null, null],
      [{ state: 'offline' }, 'No connection to BrawlTome', 'game data only'],
      [{ state: 'unavailable' }, 'BrawlTome is down', null],
      [{ state: 'updateRequired', minimumVersion: '0.2.1' }, 'Update required', 'close Brawlhalla to update'],
    ]

    for (const [service, text, detail] of cases) {
      const lines = statusLines({ ...ready, service })
      const expected: StatusLine[] = text === null ? [] : [{ tone: 'warn', text, detail, action: null }]

      expect(lines.slice(1)).toEqual(expected)
    }
  })

  test('an update the app needs while the game is closed only asks for the update', () => {
    const lines = statusLines({ ...fixture('idle'), service: { state: 'updateRequired', minimumVersion: '0.2.1' } })

    expect(lines[1]).toEqual({ tone: 'warn', text: 'Update required', detail: null, action: null })
  })

  test('a paused overlay offers to resume', () => {
    const lines = statusLines({ ...fixture('ready'), isOverlayPaused: true })

    expect(lines.at(-1)).toEqual({ tone: 'warn', text: 'Overlay paused', detail: null, action: 'resume' })
  })

  test('a waiting update says it installs when the game closes', () => {
    const waiting = statusLines({ ...fixture('ready'), update: { state: 'readyWhenGameCloses', version: '0.2.1' } })
    const downloading = statusLines({ ...fixture('ready'), update: { state: 'downloading', version: '0.2.1' } })

    expect(waiting[1]).toEqual({
      tone: 'info',
      text: 'Update 0.2.1 installs when Brawlhalla closes',
      detail: null,
      action: null,
    })

    expect(downloading[1]?.text).toBe('Updating to 0.2.1')
  })
})

describe('formats', () => {
  test('writes time since a match in one short unit', () => {
    const nowMs = 100 * HOUR_MS

    const cases: [number, string][] = [
      [20_000, 'now'],
      [12 * MINUTE_MS, '12m'],
      [2 * HOUR_MS, '2h'],
      [26 * HOUR_MS, '1d'],
    ]

    for (const [agoMs, expected] of cases) {
      expect(timeAgo(nowMs - agoMs, nowMs)).toBe(expected)
    }
  })

  test('shortens a game version to its patch', () => {
    expect(shortGameVersion('11.00.36258')).toBe('11.00')
    expect(shortGameVersion('11')).toBe('11')
    expect(shortGameVersion('')).toBeNull()
    expect(shortGameVersion(null)).toBeNull()
  })
})

describe('today', () => {
  // noon, so a few hours either way stays on the same day in any time zone the tests run in
  const noonMs = new Date(2026, 10, 23, 12).getTime()

  test('adds up the results of the day', () => {
    const matches = [
      recentMatch(noonMs - MINUTE_MS, true, 18),
      recentMatch(noonMs - HOUR_MS, false, -16),
      recentMatch(noonMs - 2 * HOUR_MS, true, 21),
    ]

    expect(todayResults(matches, noonMs)).toEqual({ wins: 2, losses: 1, ratingChange: 23 })
  })

  test('skips matches without a result and matches of another day', () => {
    const matches = [recentMatch(noonMs - MINUTE_MS, null, null), recentMatch(noonMs - 25 * HOUR_MS, true, 18)]

    expect(todayResults(matches, noonMs)).toBeNull()
  })
})
