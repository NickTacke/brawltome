import type { MatchInsights } from '@brawltome/contracts'
import { readMatchInsights } from '../index'
import { asRawLine, type RawLine } from './derive'
import { type FixtureName, fixtureNames, readFixtureLine } from './fixtures'

export type Fixture = { name: FixtureName; line: RawLine; insights: MatchInsights }

const cache = new Map<FixtureName, Fixture>()

/** Each fixture's raw line beside the insights read from it without a level layout, worked out once per test run. */
export function fixtures(): Fixture[] {
  return fixtureNames.map((name) => {
    const cached = cache.get(name)

    if (cached) return cached

    const line = readFixtureLine(name)
    const insights = readMatchInsights(line, null)

    if (!insights) throw new Error(`read insights for fixture ${name}: the line was not read as a 1v1 or 2v2`)

    const fixture = { name, line: asRawLine(line), insights }

    cache.set(name, fixture)

    return fixture
  })
}

export function slotsOf(fixture: Fixture): number[] {
  return fixture.insights.summary.players.map((player) => player.slot)
}

export function insightOf(fixture: Fixture, slot: number) {
  const insight = fixture.insights.insights.players.find((player) => player.slot === slot)

  if (!insight) throw new Error(`find insight for slot ${slot} in ${fixture.name}: missing`)

  return insight
}
