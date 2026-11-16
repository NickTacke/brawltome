import { describe, expect, test } from 'bun:test'
import { ADVANTAGE_SAMPLE_MS } from '@brawltome/contracts'
import { sideOf, winningSides } from './derive'
import { leadAt, leadTimes } from './derive-state'
import { fixtures } from './insights'

describe.each(fixtures())('lead over $name', (fixture) => {
  const { line } = fixture
  const advantage = fixture.insights.advantage
  const durationMs = fixture.insights.summary.durationMs
  const firstSide = sideOf(line, line.match.players[0]?.slot ?? 0)
  const times = leadTimes(durationMs, ADVANTAGE_SAMPLE_MS)

  test('has one sample every half second and one at the end, starting level', () => {
    expect(advantage).toHaveLength(times.length)
    expect(advantage[0]).toBe(0)
  })

  test('every sample is the stocks and damage of each side at that time', () => {
    for (const [index, timeMs] of times.entries()) {
      expect(advantage[index]).toBeCloseTo(leadAt(line, firstSide, timeMs), 9)
    }
  })

  test('ends with the winners ahead', () => {
    const winners = winningSides(line)
    const winnerSign = winners.has(firstSide) ? 1 : -1

    expect(winners.size).toBe(1)
    expect(Math.sign(advantage.at(-1) ?? 0)).toBe(winnerSign)
  })
})
