import { describe, expect, test } from 'bun:test'
import { isInsightMatch, readMatchInsights } from '../index'
import { fixtureNames, readFixtureLine } from './fixtures'

type EditableLine = {
  match: { rules: { mode: { id: number; name: string } }; players: unknown[] }
  timeline?: { animations?: unknown }
}

function editableFixture(): EditableLine {
  return readFixtureLine('doubles-a') as EditableLine
}

describe('which matches get insights', () => {
  test.each(fixtureNames)('a stock %s with a timeline does', (name) => {
    expect(isInsightMatch(readFixtureLine(name))).toBe(true)
  })

  test('a mode other than stock does not', () => {
    const line = editableFixture()

    line.match.rules.mode = { id: 1, name: 'Timed' }

    expect(isInsightMatch(line)).toBe(false)
    expect(readMatchInsights(line, null)).toBeNull()
  })

  test('three players do not', () => {
    const line = editableFixture()

    line.match.players = line.match.players.slice(0, 3)

    expect(isInsightMatch(line)).toBe(false)
    expect(readMatchInsights(line, null)).toBeNull()
  })

  test('a line without a timeline, or no line at all, does not', () => {
    const line = editableFixture()

    delete line.timeline

    expect(isInsightMatch(line)).toBe(false)
    expect(readMatchInsights(line, null)).toBeNull()
    expect(isInsightMatch(null)).toBe(false)
    expect(isInsightMatch({ exit: 3 })).toBe(false)
  })

  test('a line that records no animations still gets them, stage marks included', () => {
    const line = editableFixture()

    delete line.timeline?.animations

    const insights = readMatchInsights(line, null)

    expect(insights?.insights.stage.marks.hits.length).toBeGreaterThan(0)
    expect(insights?.insights.stage.marks.tracks.length).toBe(4)
    expect(insights?.insights.stage.hasAnimations).toBe(false)
  })
})
