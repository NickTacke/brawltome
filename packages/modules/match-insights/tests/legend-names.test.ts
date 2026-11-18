import { describe, expect, test } from 'bun:test'
import { readMatchInsights } from '../index'
import { readFixtureLine } from './fixtures'

type Legend = { id: number; name: string }
type LineWithLegends = { match: { players: { legend: Legend }[] } }

// the legend the duel's first player played, as the line names it, and how the page names it after
function summaryLegendOf(legend: Legend) {
  const line = structuredClone(readFixtureLine('duel-a')) as LineWithLegends
  const [first] = line.match.players

  if (!first) throw new Error('swap the legend of duel-a: no players')

  first.legend = legend

  const player = readMatchInsights(line, null)?.summary.players[0]

  return { legendName: player?.legendName, legendKey: player?.legendKey }
}

describe('the legend each player played', () => {
  test('is named as the game spells it, every word capitalised', () => {
    expect(summaryLegendOf({ id: 66, name: 'KING ZUVA' })).toEqual({ legendName: 'King Zuva', legendKey: 'king zuva' })
  })

  test('takes the key the site knows the portrait by, which for red raptor has no space', () => {
    expect(summaryLegendOf({ id: 17, name: 'RED RAPTOR' })).toEqual({
      legendName: 'Red Raptor',
      legendKey: 'redraptor',
    })
  })

  test('is found by its id, whatever the line calls it', () => {
    expect(summaryLegendOf({ id: 73, name: 'OATHBREAKER' })).toEqual({ legendName: 'Morgwyn', legendKey: 'morgwyn' })
  })

  test('newer than the game data falls back to the name the line gives it', () => {
    expect(summaryLegendOf({ id: 999, name: 'NEW LEGEND' })).toEqual({
      legendName: 'New Legend',
      legendKey: 'new legend',
    })
  })
})
