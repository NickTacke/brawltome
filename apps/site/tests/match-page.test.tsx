import { describe, expect, test } from 'bun:test'
import type { Habit, MatchInsights, SummaryPlayer } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchPage } from '../src/components/match/MatchPage'
import { matchPlayersOf } from '../src/components/match/match-players'
import { HabitDetail } from '../src/components/match/modules/HabitDetail'
import { moveCode } from '../src/components/match/review/move-notation'
import { type InsightsFixture, matchDetailOf, readInsights } from './match-fixtures'

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

function clock(timeMs: number): string {
  const seconds = Math.round(timeMs / 1000)

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// how an opening began, as the openings lists name it
const leadLabels: Record<string, string> = {
  free: 'Clean hit',
  swing: 'During a swing',
  whiff: 'After a miss',
  dodge: 'After a dodge',
  landing: 'On landing',
  trade: 'Trade',
  throw: 'Thrown weapon',
}

function timesText(count: number): string {
  return `${count} ${count === 1 ? 'time' : 'times'}`
}

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

  test('shows every player’s share of neutral won and damage per opening', () => {
    const neutralOf = (slot: number) => insightOf(insights, slot).insight.neutral

    const shares = players.map((player) => {
      const { openingsWon, openingsLost } = neutralOf(player.slot)
      const openings = openingsWon + openingsLost

      return openings > 0 ? share(openingsWon / openings) : '–'
    })

    expectRun(texts, ['Neutral won', ...shares])

    expectRun(texts, [
      'Damage per opening',
      ...players.map((player) => neutralOf(player.slot).damagePerOpening.toFixed(1)),
    ])
  })

  test('shows the picked player’s neutral share and each of their stocks', () => {
    const { neutral, stocks: lives } = insightOf(insights, picked.slot).insight
    const openings = neutral.openingsWon + neutral.openingsLost
    const wonShare = openings > 0 ? share(neutral.openingsWon / openings) : '–'

    expectRun(texts, [
      'Neutral',
      picked.name,
      wonShare,
      String(neutral.openingsWon),
      'won',
      '·',
      String(neutral.openingsLost),
      'lost',
      neutral.damagePerOpening.toFixed(1),
      'per opening',
    ])

    for (const life of lives) {
      expectRun(texts, [
        `Stock ${life.index + 1}`,
        String(life.openingsWon),
        'won',
        '·',
        String(life.openingsLost),
        'lost',
        String(Math.round(life.damageDealt)),
        'dealt ·',
        String(Math.round(life.damageTaken)),
        'taken',
      ])
    }
  })

  test('counts the picked player’s openings both ways round, as many as neutral says, by how each began', () => {
    const { neutral } = insightOf(insights, picked.slot).insight
    const withLead = insights.insights.moments.filter((moment) => moment.lead !== null)

    expectRun(texts, ['Opened them up', String(neutral.openingsWon), 'times'])
    expectRun(texts, ['Got opened up', String(neutral.openingsLost), 'times'])

    for (const [kind, label] of Object.entries(leadLabels)) {
      const ofKind = withLead.filter((moment) => moment.lead?.kind === kind)

      for (const way of [
        ofKind.filter((moment) => moment.attacker === picked.slot),
        ofKind.filter((moment) => moment.victim === picked.slot),
      ]) {
        const damage = way.reduce((total, moment) => total + moment.damage, 0)

        if (way.length > 0) expectRun(texts, [label, timesText(way.length), String(Math.round(damage))])
      }
    }
  })

  test('shows the damage each player did with each weapon and how long they held it', () => {
    for (const player of players) {
      const hasMoves = (weapon: string) => player.moves.some((move) => move.weapon === weapon)
      const held = player.weapons.filter((weapon) => weapon.isWeapon && hasMoves(weapon.weapon))
      const figures = held.flatMap((weapon) => [String(Math.round(weapon.damage)), clock(weapon.heldMs)])

      expectRun(texts, [player.name, ...figures])
    }
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
      const used = player.moves.filter((move) => move.uses > 0)
      const top = [...used].sort((left, right) => right.damage - left.damage).slice(0, 5)

      for (const move of top) {
        const kos = move.kos > 0 ? [`${move.kos} ${move.kos === 1 ? 'KO' : 'KOs'}`] : []

        expectRun(texts, [
          moveCode(move.label),
          ...kos,
          `${move.usesLanded} of ${move.uses}`,
          String(Math.round(move.damage)),
        ])
      }
    }
  })
})

// a habit opened up: its header and a row per option picked, read as the run of texts like the page above
function detailTextsOf(insights: MatchInsights, habit: Habit, slot: number): string[] {
  const markup = renderToStaticMarkup(
    <HabitDetail
      habit={habit}
      players={matchPlayersOf(insights)}
      selectedSlot={slot}
      durationMs={insights.summary.durationMs}
      onClose={() => undefined}
    />,
  )

  return markup
    .split(/<[^>]*>/)
    .map((text) => text.trim())
    .filter((text) => text !== '')
}

function shownRowsOf(texts: string[], habit: Habit) {
  const used = habit.options.filter((option) => option.count > 0)

  return used.map((option) => {
    const start = texts.findIndex((text, index) => text === option.label && texts[index + 1] === String(option.count))

    return { option, row: texts.slice(start, start + 5) }
  })
}

describe.each(fixtures)('an opened habit of %s', (name) => {
  const insights = readInsights(name)

  const habits = insights.insights.players.flatMap((player) =>
    player.habits.filter((habit) => habit.total > 0).map((habit) => ({ slot: player.slot, habit })),
  )

  test('shows every option picked with its count, share, punishes and damage', () => {
    for (const { slot, habit } of habits) {
      const texts = detailTextsOf(insights, habit, slot)

      for (const { option, row } of shownRowsOf(texts, habit)) {
        const shownDamage = Number(row[4])

        expect(row.slice(0, 4)).toEqual([
          option.label,
          String(option.count),
          share(option.count / habit.total),
          String(option.punished),
        ])

        expect(Math.abs(shownDamage - option.costDamage)).toBeLessThan(1)
      }
    }
  })
})
