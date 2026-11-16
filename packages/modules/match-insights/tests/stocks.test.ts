import { describe, expect, test } from 'bun:test'
import { fallsOf, msOf, stateSeries, stepAt } from './derive'
import { damageAt } from './derive-state'
import { fixtures, insightOf } from './insights'

const cases = fixtures().flatMap((fixture) =>
  fixture.insights.summary.players.map((player) => ({
    fixture,
    slot: player.slot,
    label: `${fixture.name} slot ${player.slot}`,
  })),
)

// a stock starts on the step its player went live with no stock in play
function liveStarts(series: [number, unknown][]): number[] {
  const starts: number[] = []
  let isInPlay = false

  for (const [step, status] of series) {
    if (status === 'live' && !isInPlay) starts.push(step)

    if (status === 'live') isInPlay = true

    if (status === 'ko' || status === 'eliminated') isInPlay = false
  }

  return starts
}

describe.each(cases)('stocks of $label', ({ fixture, slot }) => {
  const { line } = fixture
  const stocks = insightOf(fixture, slot).stocks
  const falls = fallsOf(line, slot)

  test('one stock per life, each KO ending one', () => {
    const starts = liveStarts(stateSeries(line, slot, 'status'))

    expect(stocks.map((stock) => stock.startMs)).toEqual(starts.map((step) => msOf(line, step)))

    expect(stocks.filter((stock) => stock.isKo).map((stock) => stock.endMs)).toEqual(
      falls.map((ko) => msOf(line, ko.step)),
    )

    expect(stocks.slice(0, -1).every((stock) => stock.isKo)).toBe(true)
  })

  // the game zeroes the damage on the KO's own step, so the step before holds what the stock went out at
  test('each stock took the damage the KO and the damage series have', () => {
    const knockedOut = stocks.filter((stock) => stock.isKo)

    for (const [index, ko] of falls.entries()) {
      expect(knockedOut[index]?.damageTaken).toBe(ko.damage as number)
      expect(knockedOut[index]?.damageTaken).toBe(damageAt(line, slot, ko.step - 1))
      expect(knockedOut[index]?.knockout?.damage).toBe(ko.damage as number)
    }

    const last = stocks.at(-1)

    if (last && !last.isKo) expect(last.damageTaken).toBe(damageAt(line, slot, line.timeline.endStep))
  })

  test('each damage tape follows the damage series from zero', () => {
    for (const stock of stocks) {
      expect(stock.tape[0]).toEqual([stock.startMs, 0])

      for (const [timeMs, damage] of stock.tape.slice(1, -1))
        expect(damage).toBe(damageAt(line, slot, stepAt(line, timeMs)))
    }
  })

  test('openings and damage per stock add up to the match', () => {
    const neutral = insightOf(fixture, slot).neutral
    const won = stocks.reduce((total, stock) => total + stock.openingsWon, 0)
    const lost = stocks.reduce((total, stock) => total + stock.openingsLost, 0)
    const dealt = stocks.reduce((total, stock) => total + stock.damageDealt, 0)

    expect(won).toBe(neutral.openingsWon)
    expect(lost).toBe(neutral.openingsLost)
    expect(dealt).toBeCloseTo(neutral.damagePerOpening * neutral.openingsWon, 6)
  })
})
