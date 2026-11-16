import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract, Moment } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchTimeline } from '../src/components/match/review/MatchTimeline'
import { MatchStage } from '../src/components/match/stage/MatchStage'
import { type InsightsFixture, readInsights } from './match-fixtures'

type Art = MatchDetailContract['art']

const queuedArt: Art = { state: 'queued', manifestUrl: null, baseUrl: null }
const playbackPath = '/match/6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f/playback/main-1/1'
const ignore = () => undefined

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
      <MatchStage insights={readInsights('duel-a')} art={queuedArt} playbackPath={playbackPath} />,
    )

    const controls = markup.slice(markup.indexOf('data-stage-controls'))

    expect(tagsWith(controls, 'data-lane=')).toHaveLength(2)
    expect(controls).toContain('aria-label="Match time"')
  })
})
