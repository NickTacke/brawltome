import { describe, expect, test } from 'bun:test'
import { selectCanonicalPlayerName } from '../reference'

const older = new Date('2026-08-01T00:00:00Z')
const newer = new Date('2026-10-01T00:00:00Z')

describe('selectCanonicalPlayerName', () => {
  test('prefers the most recently observed usable name', () => {
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Renamed', observedAt: newer },
        career: { name: 'Original', observedAt: older },
      })?.name,
    ).toBe('Renamed')
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Original', observedAt: older },
        career: { name: 'Renamed', observedAt: newer },
      })?.name,
    ).toBe('Renamed')
  })

  test('never lets an older legacy career name beat a newer ranked observation', () => {
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Current', observedAt: new Date('2026-10-05T12:00:00Z') },
        career: { name: 'Imported Legacy', observedAt: new Date('2024-01-01T00:00:00Z') },
      })?.name,
    ).toBe('Current')
  })

  test('never lets a cached leaderboard name override a live v0 name', () => {
    // V1 leaderboard names are heavily cached upstream; a newer scan can still carry a name the player dropped.
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Current V0', observedAt: older },
        career: null,
        leaderboard: { name: 'Cached Old', observedAt: newer },
      })?.name,
    ).toBe('Current V0')
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: null,
        career: { name: 'Current V0', observedAt: older },
        leaderboard: { name: 'Cached Old', observedAt: newer },
      })?.name,
    ).toBe('Current V0')
  })

  test('uses the leaderboard name when no live v0 name exists', () => {
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: null,
        career: null,
        leaderboard: { name: 'Climber', observedAt: newer },
      })?.name,
    ).toBe('Climber')
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Legacy Ranked Reference', observedAt: null },
        career: { name: 'Imported V2', observedAt: older, legacy: true },
        leaderboard: { name: 'Leaderboard', observedAt: older },
      })?.name,
    ).toBe('Leaderboard')
  })

  test('still prefers the newest legacy name when nothing live or observed on a leaderboard exists', () => {
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Legacy Ranked Reference', observedAt: null },
        career: { name: 'Imported V2', observedAt: older, legacy: true },
      })?.name,
    ).toBe('Imported V2')
  })

  test('falls back to career-first priority when observation times are missing or equal', () => {
    expect(
      selectCanonicalPlayerName({ brawlhallaId: 42, ranked: { name: 'Ranked' }, career: { name: 'Career' } })?.name,
    ).toBe('Career')
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Ranked', observedAt: newer },
        career: { name: 'Career', observedAt: newer },
      })?.name,
    ).toBe('Career')
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Legacy Ranked Reference', observedAt: null },
        career: { name: 'Career', observedAt: older },
      })?.name,
    ).toBe('Career')
  })

  test('skips unusable names regardless of recency', () => {
    expect(
      selectCanonicalPlayerName({
        brawlhallaId: 42,
        ranked: { name: 'Player 42', observedAt: newer },
        career: { name: 'Career', observedAt: older },
        leaderboard: { name: '​', observedAt: newer },
      })?.name,
    ).toBe('Career')
    expect(selectCanonicalPlayerName({ brawlhallaId: 42, ranked: null, career: null, leaderboard: null })).toBeNull()
  })
})
