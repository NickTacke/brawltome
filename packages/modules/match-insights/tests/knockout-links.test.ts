import { describe, expect, test } from 'bun:test'
import type { MatchInsights } from '@brawltome/contracts'
import { readMatchInsights } from '../index'
import { asRawLine, eventsOf, msOf, type RawEvent, type RawLine } from './derive'
import { resetSteps } from './derive-openings'
import { readFixtureLine } from './fixtures'
import { fixtures } from './insights'

// every KO the line records is on exactly one moment: the punish that led to it, or a moment of its own

function expectEveryKoOnce(line: RawLine, insights: MatchInsights | null) {
  for (const event of eventsOf(line, 'ko')) {
    const timeMs = msOf(line, event.step)

    const holding = (insights?.insights.moments ?? []).filter(
      (moment) => moment.knockout?.victim === event.player && moment.knockout?.timeMs === timeMs,
    )

    expect(holding).toHaveLength(1)
  }
}

describe.each(fixtures())('KOs of $name', (fixture) => {
  test('each KO is on exactly one moment', () => {
    expectEveryKoOnce(fixture.line, fixture.insights)
  })

  test('no two KOs share a punish', () => {
    const linked = fixture.insights.insights.knockouts.flatMap((knockout) => knockout.punishIndex ?? [])

    expect(new Set(linked).size).toBe(linked.length)
  })
})

// duel-a's player 2 KOs player 1 twice in a row; with the hits before the second KO taken out of the line, only the
// first has a punish close enough to be its KO
describe('two KOs by one killer, only the first right after a punish', () => {
  const line = asRawLine(readFixtureLine('duel-a'))
  const [firstKo, secondKo] = eventsOf(line, 'ko').filter((event) => event.player === 1 && event.killer === 2)
  const secondStep = (secondKo as RawEvent).step

  line.timeline.events = line.timeline.events.filter(
    (event) =>
      !(
        event.type === 'hit' &&
        event.attacker === 2 &&
        event.target === 1 &&
        secondStep - event.step <= resetSteps * 3
      ),
  )

  const insights = readMatchInsights(line, null)

  test('each KO is still on exactly one moment', () => {
    expectEveryKoOnce(line, insights)
  })

  test('only the first is linked to a punish', () => {
    const knockoutAt = (event: RawEvent | undefined) =>
      insights?.insights.knockouts.find((knockout) => knockout.timeMs === msOf(line, event?.step ?? 0))

    expect(knockoutAt(firstKo)?.punishIndex).not.toBeNull()
    expect(knockoutAt(secondKo)?.punishIndex).toBeNull()
  })
})
