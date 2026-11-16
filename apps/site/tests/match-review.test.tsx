import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract, Moment } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { lanePlayersOf } from '../src/components/match/review/lane-players'
import { MatchTimeline } from '../src/components/match/review/MatchTimeline'
import { classLabels } from '../src/components/match/review/moment-class'
import { ReviewCard } from '../src/components/match/review/ReviewCard'
import { HitString } from '../src/components/match/review/ReviewFacts'
import { type InsightsFixture, readInsights } from './match-fixtures'
import { ReplayWithArt } from './replay-with-art'

type Art = MatchDetailContract['art']

const queuedArt: Art = { state: 'queued', manifestUrl: null, baseUrl: null }
const playbackPath = '/match/6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f/playback/main-1/1'
const ignore = () => undefined

// what a reader sees of some markup: its words, one space apart
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function momentOf(name: InsightsFixture, key: string): Moment {
  const moment = readInsights(name).insights.moments.find((entry) => entry.key === key)

  if (!moment) throw new Error(`find moment ${key} in ${name}: not there`)

  return moment
}

// the opening tag of every element carrying an attribute
function tagsWith(markup: string, attribute: string): string[] {
  return [...markup.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, 'g'))].map((match) => match[0])
}

function renderTimeline(name: InsightsFixture, stops: Moment[], opensBelow: boolean): string {
  return renderToStaticMarkup(
    <MatchTimeline
      insights={readInsights(name)}
      timeline={null}
      selectedSlot={1}
      timeMs={20_000}
      onSeek={ignore}
      stops={stops}
      stopIndex={0}
      onGoTo={ignore}
      opensBelow={opensBelow}
    />,
  )
}

describe('the lanes', () => {
  const fixtures: InsightsFixture[] = ['duel-a', 'doubles-b']

  test.each(fixtures)('in %s every player gets a full lane, watching or at any stop', (name) => {
    const insights = readInsights(name)

    const keyStops = insights.insights.moments.filter((moment) =>
      insights.reviewStops.some((stop) => stop.slot === 1 && stop.scope === 'key' && stop.momentKey === moment.key),
    )

    for (const stops of [[], keyStops]) {
      for (const opensBelow of [false, true]) {
        const lanes = tagsWith(renderTimeline(name, stops, opensBelow), 'data-lane=')

        expect(lanes).toHaveLength(insights.summary.players.length)

        for (const lane of lanes) expect(lane).toContain('h-6')
      }
    }
  })

  test('each lane has a round bar for every stock its player had', () => {
    const insights = readInsights('doubles-b')
    const bars = tagsWith(renderTimeline('doubles-b', [], false), 'data-stock-bar')
    const stockCount = insights.insights.players.reduce((sum, player) => sum + player.stocks.length, 0)

    expect(bars).toHaveLength(stockCount)

    for (const bar of bars) expect(bar).toContain('h-2 rounded-full')
  })

  test('the stage puts the lanes in its controls', () => {
    const markup = renderToStaticMarkup(
      <ReplayWithArt insights={readInsights('duel-a')} art={queuedArt} playbackPath={playbackPath} selectedSlot={1} />,
    )

    const controls = markup.slice(markup.indexOf('data-stage-controls'))

    expect(tagsWith(controls, 'data-lane=')).toHaveLength(2)
    expect(controls).toContain('aria-label="Match time"')
  })
})

describe('the review card', () => {
  test('writes the hits in order in community notation', () => {
    const markup = renderToStaticMarkup(<HitString moment={momentOf('duel-a', 'punish-2')} />)

    expect(textOf(markup)).toBe('nlight 15 → nair 16')
  })

  test('a KO stop reads like a line of a game review', () => {
    const insights = readInsights('duel-a')

    const card = (
      <ReviewCard
        moment={momentOf('duel-a', 'punish-25')}
        lanes={lanePlayersOf(insights)}
        count={{ index: 2, total: 12, onReplay: ignore }}
        isWide={false}
      />
    )

    expect(textOf(renderToStaticMarkup(card))).toBe(
      '3 of 12 KO 30 Player A hit by Player B slight 14 → rec 16 Caught mid unarmed slight · Off the top at 187',
    )
  })

  test('a KO the game credits without a punish names the move that sent them out', () => {
    const insights = readInsights('doubles-b')

    const card = (
      <ReviewCard
        moment={momentOf('doubles-b', 'knockout-2-58512')}
        lanes={lanePlayersOf(insights)}
        count={{ index: 0, total: 1, onReplay: ignore }}
        isWide
      />
    )

    expect(textOf(renderToStaticMarkup(card))).toBe(
      '1 of 1 Early KO Player B sent out by Player C greatsword dsig · Off the bottom at 94',
    )
  })

  test('names the KO classes as players do', () => {
    expect([classLabels.ko, classLabels['early-ko'], classLabels.fall, classLabels['team-ko']]).toEqual([
      'KO',
      'Early KO',
      'SD',
      'Team KO',
    ])
  })
})
