import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchPage } from '../src/components/match/MatchPage'
import { cameraModeOptions } from '../src/components/match/stage/camera-mode'
import { readPlaybackTimeline } from '../src/components/match/stage/playback-timeline'
import { StageDeck } from '../src/components/match/stage/StageDeck'
import { StagePlay } from '../src/components/match/stage/StagePlay'
import { initialLegends } from '../src/components/match/stage/use-legends'
import { matchDetailOf, readInsights, readPlayback } from './match-fixtures'
import { ReplayWithArt } from './replay-with-art'

type Art = MatchDetailContract['art']

const failedArt: Art = { state: 'failed', manifestUrl: null, baseUrl: null }
const queuedArt: Art = { state: 'queued', manifestUrl: null, baseUrl: null }
const unavailableNote = 'Legends unavailable for this match'
const playbackPath = '/match/6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f/playback/main-1/1'
// both players of the fixture are in play here, before the first KO
const bothInPlayMs = 20_000

function renderStagePlay(art: Art): string {
  const insights = readInsights('duel-a')
  const legends = { ...initialLegends(art, playbackPath), timeline: readPlaybackTimeline(readPlayback('duel-a')) }

  return renderToStaticMarkup(
    <StagePlay insights={insights} legends={legends} timeMs={bothInPlayMs} cameraMode="game" selectedSlot={1} />,
  )
}

// the markup of the first element carrying an attribute, up to its own closing tag
function elementWith(markup: string, attribute: string): string {
  const at = markup.indexOf(attribute)

  if (at < 0) throw new Error(`no element with ${attribute}`)

  const start = markup.lastIndexOf('<', at)
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
      <ReplayWithArt insights={readInsights('duel-a')} art={failedArt} playbackPath={playbackPath} selectedSlot={1} />,
    )

    const group = elementWith(markup, 'data-stage-controls-group')
    const button = elementWith(group, 'aria-label="Fullscreen"')

    expect(button).toContain('<button')
    expect(button).toContain('top-2')
    expect(button).toContain('right-2')
  })
})

// what StageDeck reads of the fullscreen and the controls, with the screen filled and the controls up
const filledScreen = { isOn: true, isOverlay: false, exit: () => undefined, toggle: () => undefined }

const shownControls = {
  isShown: true,
  isHeld: false,
  wake: () => undefined,
  stage: {
    onPointerMove: () => undefined,
    onPointerDown: () => undefined,
    onPointerLeave: () => undefined,
    onClick: () => undefined,
  },
  bar: { onPointerEnter: () => undefined, onPointerLeave: () => undefined },
}

describe('the stage in fullscreen', () => {
  test('the legends note lies under the tools in the top left corner, never on them', () => {
    const markup = renderToStaticMarkup(
      <StageDeck
        controls={shownControls}
        fullscreen={filledScreen}
        lanes={{ edge: 'bottom' }}
        transport={null}
        timeline={() => null}
        speed={null}
        tools={<span>Camera tools</span>}
        note={<span>{unavailableNote}</span>}
      />,
    )

    const corner = elementWith(markup, 'data-stage-top-left')

    expect(corner).toContain('flex-col')
    expect(corner.indexOf('Camera tools')).toBeGreaterThan(-1)
    expect(corner.indexOf(unavailableNote)).toBeGreaterThan(corner.indexOf('Camera tools'))
  })

  test('on the page, the note is part of that corner', () => {
    const markup = renderToStaticMarkup(
      <ReplayWithArt insights={readInsights('duel-a')} art={failedArt} playbackPath={playbackPath} selectedSlot={1} />,
    )

    expect(elementWith(markup, 'data-stage-top-left')).toContain(unavailableNote)
  })
})

describe('the review page', () => {
  test('shows the map and plays the match back on its stage', () => {
    const match = matchDetailOf('doubles-b', { state: 'queued', manifestUrl: null, baseUrl: null })
    const markup = renderToStaticMarkup(<MatchPage match={match} insights={readInsights('doubles-b')} />)

    expect(markup).toContain(`>${match.mapName}</h1>`)
    expect(markup).toContain('aria-label="The match on its stage"')
    expect(markup).toContain('data-stage-controls-group')
  })
})
