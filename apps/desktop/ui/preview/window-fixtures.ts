/// <reference types="vite/client" />
import type { AppStatus, RecentMatch } from '../window/app-status'

// the json files are the shape the app sends; the rust tests compare against the same files
const fixtureFiles = import.meta.glob<AppStatus>('../../tests/fixtures/app-status-*.json', {
  eager: true,
  import: 'default',
})

const MINUTE_MS = 60_000
// a few minutes after the newest match, so the times read like a session in progress
const FIXTURE_CLOCK_AHEAD_MS = 12 * MINUTE_MS
// an evening, so a session's matches all fall on the same day
const EVENING_MS = new Date(2026, 10, 16, 21, 42).getTime()

export function appStatusFixture(name: string): AppStatus | null {
  return fixtureFiles[`../../tests/fixtures/app-status-${name}.json`] ?? null
}

function requireFixture(name: string): AppStatus {
  const status = appStatusFixture(name)

  if (status === null) throw new Error(`load preview fixture ${name}: no app-status-${name}.json`)

  return status
}

export function fixtureNowMs(status: AppStatus): number {
  const newestMs = status.recentMatches[0]?.startedAtMs ?? 0

  return newestMs + FIXTURE_CLOCK_AHEAD_MS
}

function recentMatch(minutesAgo: number, names: [string, string][], ratingChange: number): RecentMatch {
  const opponents = names.map(([name, legend], index) => ({ brawlhallaId: 91913800 + index, name, legend }))

  return { startedAtMs: EVENING_MS - minutesAgo * MINUTE_MS, opponents, isWin: ratingChange > 0, ratingChange }
}

// an evening of ranked, as many matches as the app keeps
function busyEvening(): AppStatus {
  const recentMatches = [
    recentMatch(0.5, [['Shinigami', 'Hattori']], 18),
    recentMatch(12, [['tidecaller', 'Petra']], -16),
    recentMatch(31, [['Vexx', 'Orion']], 21),
    recentMatch(
      64,
      [
        ['Koa', 'Ada'],
        ['rimelight', 'Lucien'],
      ],
      14,
    ),
    recentMatch(128, [['Sunder', 'Mordex']], 11),
  ]

  return { ...requireFixture('ready'), recentMatches }
}

export type WindowCell = { title: string; status: AppStatus; nowMs: number }

export function windowVariantCells(): WindowCell[] {
  const evening = busyEvening()
  const cell = (title: string, status: AppStatus): WindowCell => ({ title, status, nowMs: EVENING_MS })
  const unsupported = requireFixture('unsupported')

  return [
    cell('Ready, in the menus', evening),
    cell('New patch', { ...evening, game: unsupported.game, detection: unsupported.detection }),
    cell('Offline', { ...evening, service: { state: 'offline' } }),
    cell('App too old', { ...evening, service: { state: 'updateRequired', minimumVersion: '0.2.1' } }),
    cell('Overlay paused', { ...evening, isOverlayPaused: true }),
  ]
}
