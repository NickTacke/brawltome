import { describe, expect, test } from 'bun:test'
import type { MatchInsights, SummaryPlayer } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchPage } from '../src/components/match/MatchPage'
import { type InsightsFixture, matchDetailOf } from './match-fixtures'

// the numbers the page shows, each as it is written next to its neighbours: these tests read the markup as the run of
// texts between its tags and look for each figure's run, so a number lands under the right name and in the right row

const fixtures: InsightsFixture[] = ['duel-a', 'duel-b', 'doubles-a', 'doubles-b']
const noArt = { state: 'none', manifestUrl: null, baseUrl: null } as const

function pageOf(name: InsightsFixture): { insights: MatchInsights; markup: string; texts: string[] } {
  const match = matchDetailOf(name, noArt)
  const insights = match.insights as MatchInsights
  const markup = renderToStaticMarkup(<MatchPage match={match} insights={insights} />)

  const texts = markup
    .split(/<[^>]*>/)
    .map((text) => text.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").trim())
    .filter((text) => text !== '')

  return { insights, markup, texts }
}

function hasRun(texts: string[], run: string[]): boolean {
  return texts.some((_, start) => run.every((text, offset) => texts[start + offset] === text))
}

function expectRun(texts: string[], run: string[]) {
  expect({ run, isShown: hasRun(texts, run) }).toEqual({ run, isShown: true })
}

// the page's order of players: the winners first, then by side and slot
function playersInOrder(insights: MatchInsights): SummaryPlayer[] {
  const rank = (player: SummaryPlayer) => [Number(!player.isWinner), player.side, player.slot]

  return [...insights.summary.players].sort((left, right) => {
    const [a, b] = [rank(left), rank(right)]

    return (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0)
  })
}

const share = (value: number) => `${Math.round(value * 100)}%`

function insightOf(insights: MatchInsights, slot: number) {
  const insight = insights.insights.players.find((entry) => entry.slot === slot)
  const extras = insights.extras.players.find((entry) => entry.slot === slot)

  if (!insight || !extras) throw new Error(`fixture has no insight for slot ${slot}`)

  return { insight, extras }
}

describe.each(fixtures)('the match page of %s', (name) => {
  const { insights, markup, texts } = pageOf(name)
  const players = playersInOrder(insights)
  const picked = players[0] as SummaryPlayer
  const stocks = insights.extras.stocks ?? 0

  test('shows every player’s stocks left, KOs and damage under their name', () => {
    for (const player of players) expect(markup).toContain(`aria-label="${player.stocksLeft} of ${stocks} stocks left"`)

    expectRun(texts, ['KOs', ...players.map((player) => String(player.kos))])
    expectRun(texts, ['Damage', ...players.map((player) => String(Math.round(player.damageDealt)))])
  })

  test('shows every player’s accuracy from their swings that hit', () => {
    const accuracies = players.map((player) => {
      const { oddities } = insightOf(insights, player.slot).insight

      return oddities.swings > 0 ? share(oddities.swingsHit / oddities.swings) : '–'
    })

    expectRun(texts, ['Accuracy', ...accuracies])
  })

  test('shows the openings the picked player won and lost', () => {
    const { neutral } = insightOf(insights, picked.slot).insight

    expectRun(texts, ['Neutral', picked.name])
    expectRun(texts, [String(neutral.openingsWon), 'won', '·', String(neutral.openingsLost), 'lost'])
  })

  test('shows every habit’s top option and its share for every player', () => {
    for (const player of players) {
      for (const habit of insightOf(insights, player.slot).insight.habits) {
        const run = habit.total > 0 ? [share(habit.share), habit.top?.label ?? ''] : ['–', 'Never came up']

        expectRun(texts, run)
      }
    }
  })

  test('shows how the match ended for the picked player in the lead panel', () => {
    const firstSide = insights.summary.players[0]?.side
    const last = (insights.advantage.at(-1) ?? 0) * (picked.side === firstSide ? 1 : -1)
    const rounded = Math.abs(last).toFixed(1)
    const written = rounded === '0.0' ? rounded : `${last > 0 ? '+' : '−'}${rounded}`

    expectRun(texts, ['Final lead', written])
  })

  test('shows every movement row with each player’s value', () => {
    const rows: [string, (slot: number) => string][] = [
      ['Dashes', (slot) => String(insightOf(insights, slot).extras.dashes)],
      ['Jumps', (slot) => String(insightOf(insights, slot).extras.jumps)],
      ['Air jumps', (slot) => String(insightOf(insights, slot).extras.airJumps)],
      ['Dash jumps', (slot) => String(insightOf(insights, slot).extras.dashJumps)],
      ['Dodges', (slot) => String(players.find((player) => player.slot === slot)?.dodges)],
      ['Chase dodges', (slot) => String(insightOf(insights, slot).insight.oddities.chaseDodges)],
      ['Gravity cancels', (slot) => String(insightOf(insights, slot).insight.oddities.gravityCancels)],
      ['Longest airtime', (slot) => `${(insightOf(insights, slot).insight.oddities.longestAirMs / 1000).toFixed(1)}s`],
      ['Inputs / minute', (slot) => String(Math.round(insightOf(insights, slot).extras.inputsPerMinute))],
      ['Hitstun mashing', (slot) => `${insightOf(insights, slot).insight.oddities.mashPerSecond.toFixed(1)}/s`],
      [
        'Throws landed',
        (slot) => `${insightOf(insights, slot).insight.oddities.throwsHit}/${insightOf(insights, slot).extras.throws}`,
      ],
      ['Weapon pickups', (slot) => String(insightOf(insights, slot).extras.pickups)],
    ]

    for (const [label, valueFor] of rows) expectRun(texts, [label, ...players.map((player) => valueFor(player.slot))])
  })

  test('shows each player’s five most damaging moves with the uses that landed', () => {
    for (const player of players) {
      const top = player.moves.filter((move) => move.uses > 0).slice(0, 5)

      for (const move of top) expectRun(texts, [`${move.usesLanded} of ${move.uses}`, String(Math.round(move.damage))])
    }
  })
})
