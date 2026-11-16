import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { cameraModeOptions } from '../src/components/match/stage/camera-mode'
import { MatchStage } from '../src/components/match/stage/MatchStage'
import { readPlaybackTimeline } from '../src/components/match/stage/playback-timeline'
import { StagePlay } from '../src/components/match/stage/StagePlay'
import { initialLegends } from '../src/components/match/stage/use-legends'
import { readInsights, readPlayback } from './match-fixtures'

type Art = MatchDetailContract['art']

const failedArt: Art = { state: 'failed', manifestUrl: null, baseUrl: null }
const queuedArt: Art = { state: 'queued', manifestUrl: null, baseUrl: null }
const unavailableNote = 'Legends unavailable for this match'
const playbackPath = '/match/6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f/playback/main-1/1'
// both players of the fixture are in play here, before the first KO
const bothInPlayMs = 20_000

function renderStagePlay(art: Art): string {
  const insights = readInsights('duel-a')
  const legends = { ...initialLegends(art), timeline: readPlaybackTimeline(readPlayback('duel-a')) }

  return renderToStaticMarkup(
    <StagePlay insights={insights} legends={legends} timeMs={bothInPlayMs} cameraMode="game" selectedSlot={1} />,
  )
}

// the markup of the first element carrying an attribute, up to its own closing tag
function elementWith(markup: string, attribute: string): string {
  const start = markup.lastIndexOf('<', markup.indexOf(attribute))
  const tag = /^<(\w+)/.exec(markup.slice(start))?.[1] ?? 'div'
  const pattern = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g')
  let depth = 0

  pattern.lastIndex = start

  for (let match = pattern.exec(markup); match; match = pattern.exec(markup)) {
    depth += match[0].startsWith('</') ? -1 : 1

    if (depth === 0) return markup.slice(start, pattern.lastIndex)
  }

  return markup.slice(start)
}

describe('the match stage', () => {
  test('with failed art, it draws portrait tokens and says the legends are unavailable', () => {
    const markup = renderStagePlay(failedArt)

    expect(markup).toContain('alt="Player A"')
    expect(markup).toContain('alt="Player B"')
    expect(markup).toContain('/images/legends/avatars/')
    expect(markup).toContain(unavailableNote)
  })

  test('with art still queued, it draws portrait tokens without the note', () => {
    const markup = renderStagePlay(queuedArt)

    expect(markup).toContain('alt="Player A"')
    expect(markup).toContain('alt="Player B"')
    expect(markup).not.toContain(unavailableNote)
  })

  test('the camera is the game’s or fixed, nothing else', () => {
    expect(cameraModeOptions.map((option) => option.label)).toEqual(['Game', 'Fixed'])
  })

  test('the fullscreen button sits in the top right of the controls on the stage', () => {
    const markup = renderToStaticMarkup(
      <MatchStage insights={readInsights('duel-a')} art={failedArt} playbackPath={playbackPath} />,
    )

    const group = elementWith(markup, 'data-stage-controls-group')
    const button = elementWith(group, 'aria-label="Fullscreen"')

    expect(button).toContain('<button')
    expect(button).toContain('top-2')
    expect(button).toContain('right-2')
  })
})
