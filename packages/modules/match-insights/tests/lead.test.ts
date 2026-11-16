import { describe, expect, test } from 'bun:test'
import { ADVANTAGE_SAMPLE_MS } from '@brawltome/contracts'
import { sideOf, winningSides } from './derive'
import { leadAt, standingAt } from './derive-state'
import { fixtures } from './insights'

describe.each(fixtures())('lead over $name', (fixture) => {
  const { line } = fixture
  const advantage = fixture.insights.advantage
  const durationMs = fixture.insights.summary.durationMs
  const firstSide = sideOf(line, line.match.players[0]?.slot ?? 0)

  test('has one sample every half second, starting level', () => {
    expect(advantage).toHaveLength(Math.floor(durationMs / ADVANTAGE_SAMPLE_MS) + 1)
    expect(advantage[0]).toBe(0)
  })

  test('every sample is the stocks and damage of each side at that time', () => {
    for (const [index, lead] of advantage.entries()) {
      expect(lead).toBeCloseTo(leadAt(line, firstSide, index * ADVANTAGE_SAMPLE_MS), 9)
    }
  })

  // a stock at or past the stock damage counts as spent, so the match can end level when every winner still in play
  // is that deep in damage
  test('ends on the winner side, or level when every winner left is past the stock damage', () => {
    const last = advantage.at(-1) ?? 0
    const lastMs = (advantage.length - 1) * ADVANTAGE_SAMPLE_MS
    const winners = winningSides(line)
    const winnerSign = winners.has(firstSide) ? 1 : -1
    const winnerSlots = line.match.players.filter((player) => winners.has(sideOf(line, player.slot)))
    const isWinnerLeft = winnerSlots.some((player) => standingAt(line, player.slot, lastMs) > 0)

    expect(winners.size).toBe(1)
    expect(Math.sign(last)).toBe(isWinnerLeft ? winnerSign : 0)
  })
})
