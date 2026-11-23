import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract, StageBox } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchPage } from '../src/components/match/MatchPage'
import { ReviewMarkers } from '../src/components/match/review/ReviewMarkers'
import { cameraModeOptions } from '../src/components/match/stage/camera-mode'
import { MomentRing } from '../src/components/match/stage/MomentRing'
import { PlayEffects } from '../src/components/match/stage/PlayEffects'
import { StageViewContext, wholeStage } from '../src/components/match/stage/play-camera'
import { readPlaybackTimeline } from '../src/components/match/stage/playback-timeline'
import type { Pose } from '../src/components/match/stage/pose'
import { StageDeck } from '../src/components/match/stage/StageDeck'
import { StagePicture } from '../src/components/match/stage/StagePicture'
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

  test('with art still queued, it draws portrait tokens and says the legends are being drawn', () => {
    const markup = renderStagePlay(queuedArt)

    expect(markup).toContain('alt="Player A"')
    expect(markup).toContain('alt="Player B"')
    expect(markup).toContain('Drawing legends…')
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
    onPointerUp: () => undefined,
    onPointerCancel: () => undefined,
    onPointerLeave: () => undefined,
    onClick: () => undefined,
  },
  bar: { onPointerEnter: () => undefined, onPointerLeave: () => undefined },
}

describe('the level on the stage', () => {
  const stage = readInsights('duel-a').insights.stage

  const withLines = {
    ...stage,
    segments: [{ fromX: 0.2, fromY: 0.6, toX: 0.8, toY: 0.6, isSoft: false }],
  }

  const platform = {
    file: 'Space.Platform_Space1.png',
    x: 0.25,
    y: 0.5,
    width: 0.5,
    height: 0.25,
    rotation: 10,
    url: 'https://art.test/sheets/10a43fccdae5677c.webp',
  }

  const renderPicture = (art: (typeof platform)[]) =>
    renderToStaticMarkup(<StagePicture stage={withLines} art={art} trails={[]} shownSlots={[]} window={null} />)

  test('a platform with art is drawn as its image over its box, under the collision lines', () => {
    const markup = renderPicture([platform])
    const height = 160 / stage.aspect

    expect(markup).toContain(`href="${platform.url}"`)
    expect(markup).toContain('x="40"')
    expect(markup).toContain(`y="${platform.y * height}"`)
    expect(markup).toContain('width="80"')
    expect(markup).toContain(`height="${platform.height * height}"`)
    expect(markup).toContain(`transform="rotate(10 40 ${platform.y * height})"`)
    expect(markup.indexOf('<image')).toBeLessThan(markup.indexOf('<line'))
  })

  test('without art the stage keeps its collision lines alone', () => {
    const markup = renderPicture([])

    expect(markup).not.toContain('<image')
    expect(markup).toContain('<line')
  })
})

describe('the rings on the stage', () => {
  // a legend's ring is 216 level units across and 80 above the feet: 5% of this box's width, 5% of its height up.
  // on a stage too small for that to show, it stays 32 pixels
  const box: StageBox = { minX: -500, minY: 200, width: 4320, height: 1600 }
  const legends = { box, areLegends: true }
  const tokens = { box, areLegends: false }
  const aroundLegend = 'left:50%;top:45%;width:max(32px, 5%);aspect-ratio:1'
  const aroundToken = 'left:50%;top:calc(50% - 14px);width:min(64px, 10%);aspect-ratio:1'
  const firstHit = readInsights('duel-a').insights.stage.marks.hits[0]
  const punish = readInsights('duel-a').insights.moments.find((moment) => moment.attacker !== null)

  if (!firstHit || !punish) throw new Error('the duel-a fixture has no hit or no punish')

  const moment = { ...punish, spot: { x: 0.5, y: 0.5 } }

  const standingAt = (slot: number, x: number): Pose => ({
    slot,
    x,
    y: 0.5,
    isInPlay: true,
    facingRight: true,
    weapon: 'Unarmed',
    isHitstun: false,
    isDodging: false,
    damage: 0,
    stocksLeft: 3,
  })

  const poses = [standingAt(moment.victim, 0.5), standingAt(moment.attacker ?? 0, 0.25)]

  // the stop's rings as the stage hands them how its players are drawn
  const renderMarkers = (bodies: typeof legends) =>
    renderToStaticMarkup(
      <StageViewContext.Provider value={{ bodies, camera: wholeStage }}>
        <ReviewMarkers moment={moment} poses={poses} hits={[]} />
      </StageViewContext.Provider>,
    )

  test('a review’s stop rings its two players around their legends’ bodies, in level units', () => {
    const markup = renderMarkers(legends)

    expect(markup).toContain(aroundLegend)
    expect(markup).toContain('left:25%;top:45%;width:max(32px, 5%);aspect-ratio:1')
  })

  test('while tokens stand in for the legends, the rings keep the tokens’ size', () => {
    expect(renderMarkers(tokens)).toContain(aroundToken)
  })

  test('the moment being watched is ringed around the body of whoever gets hit', () => {
    const markup = renderToStaticMarkup(<MomentRing moment={moment} bodies={legends} timeMs={moment.timeMs} />)

    expect(markup).toContain(aroundLegend)
  })

  test('a hit flashes on the target’s body, from a small ring out to the ring around it', () => {
    const hit = { ...firstHit, x: 0.5, y: 0.5 }

    const flashAt = (timeMs: number) =>
      renderToStaticMarkup(<PlayEffects hits={[hit]} kos={[]} bodies={legends} timeMs={timeMs} />)

    expect(flashAt(hit.timeMs)).toContain('left:50%;top:45%;width:max(8px, 1.25%);aspect-ratio:1')
    expect(flashAt(hit.timeMs + 449)).toMatch(/left:50%;top:45%;width:max\(31\.9\d*px, 4\.99\d*%\)/)
  })
})

describe('the stage in fullscreen', () => {
  test('the legends note lies under the tools in the top left corner, never on them', () => {
    const markup = renderToStaticMarkup(
      <StageDeck
        controls={shownControls}
        fullscreen={filledScreen}
        lanes={{ edge: 'bottom' }}
        fold={{ isFolded: false, toggle: () => undefined }}
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
