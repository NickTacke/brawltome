import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract, StageBox, StageKo } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchPage } from '../src/components/match/MatchPage'
import { ReviewMarkers } from '../src/components/match/review/ReviewMarkers'
import { cameraModeOptions } from '../src/components/match/stage/camera-mode'
import { KoMarkers } from '../src/components/match/stage/KoMarkers'
import { MomentRing } from '../src/components/match/stage/MomentRing'
import { PlayEffects } from '../src/components/match/stage/PlayEffects'
import { boxInFrame, fixedCamera, frameAspect, StageViewContext } from '../src/components/match/stage/play-camera'
import { readPlaybackTimeline } from '../src/components/match/stage/playback-timeline'
import type { Pose } from '../src/components/match/stage/pose'
import { StageDeck } from '../src/components/match/stage/StageDeck'
import { StageFrame } from '../src/components/match/stage/StageFrame'
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

function renderStagePlay(art: Art, isPlaying = false): string {
  const insights = readInsights('duel-a')
  const legends = { ...initialLegends(art, playbackPath), timeline: readPlaybackTimeline(readPlayback('duel-a')) }

  return renderToStaticMarkup(
    <StagePlay
      insights={insights}
      legends={legends}
      timeMs={bothInPlayMs}
      cameraMode="game"
      selectedSlot={1}
      isPlaying={isPlaying}
    />,
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

  test('its window has the shape of the game’s screen, whatever the level’s', () => {
    expect(elementWith(renderStagePlay(failedArt), 'data-stage-window')).toContain('aspect-video')
  })

  test('the picture of the level has a layer of its own only while the clock runs', () => {
    const openingTag = (markup: string) => elementWith(markup, 'data-stage-picture').split('>')[0]

    expect(openingTag(renderStagePlay(failedArt, true))).toContain('will-change-transform')
    expect(openingTag(renderStagePlay(failedArt, false))).not.toContain('will-change-transform')
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

  test('a mirrored platform is drawn at its size without the sign, flipped over its corner before its turn', () => {
    const markup = renderPicture([{ ...platform, width: -0.5, height: -0.25 }])
    const height = 160 / stage.aspect
    const y = platform.y * height

    expect(markup).toContain('x="40"')
    expect(markup).toContain(`y="${y}"`)
    expect(markup).toContain('width="80"')
    expect(markup).toContain(`height="${platform.height * height}"`)
    expect(markup).toContain(`transform="rotate(10 40 ${y}) translate(40 ${y}) scale(-1 -1) translate(-40 ${-y})"`)
  })

  test('without art the stage keeps its collision lines alone', () => {
    const markup = renderPicture([])

    expect(markup).not.toContain('<image')
    expect(markup).toContain('<line')
  })

  test('the art isn’t cut at the stage box, so it runs on to the frame’s edge', () => {
    expect(renderPicture([platform])).toContain('overflow-visible')
    expect(elementWith(renderStagePlay(failedArt), 'data-stage-picture')).toContain('overflow-visible')
  })
})

// Shiganshina District's camera bounds are wider than the game's screen, Twilight Grove's taller
const wideBox: StageBox = { minX: -750, minY: -750, width: 4900, height: 2650 }
const tallBox: StageBox = { minX: -2371, minY: -1300, width: 4742.15, height: 3035 }

type FrameRect = { left: number; top: number; width: number; height: number }

describe('the stage box on the playback frame', () => {
  const frame = { width: 1600, height: 1600 / frameAspect }
  const share = '(-?[\\d.]+(?:e-?\\d+)?)'

  // the duel played on a level of another shape, under the fixed camera
  function renderOn(box: StageBox, timeMs = bothInPlayMs, kos: StageKo[] = []): string {
    const insights = readInsights('duel-a')
    const marks = { ...insights.insights.stage.marks, kos }
    const stage = { ...insights.insights.stage, box, aspect: box.width / box.height, marks }
    const onLevel = { ...insights, insights: { ...insights.insights, stage } }
    const legends = initialLegends(failedArt, playbackPath)

    return renderToStaticMarkup(
      <StagePlay
        insights={onLevel}
        legends={legends}
        timeMs={timeMs}
        cameraMode="stage"
        selectedSlot={1}
        isPlaying={false}
      />,
    )
  }

  function numbersOf(text: string, pattern: RegExp): number[] {
    const found = pattern.exec(text)

    if (!found) throw new Error(`no ${pattern.source} in the markup`)

    return found.slice(1).map(Number)
  }

  // where the picture's layer puts the box: the layer is the frame's size, moved by shares of it and scaled from its
  // top left, and the picture in it is as wide as the layer and has the box's shape
  function boxOfPicture(markup: string, box: StageBox): FrameRect {
    const transform = new RegExp(`transform:translate\\(${share}%, ${share}%\\) scale\\(${share}\\)`)
    const [x = 0, y = 0, scale = 0] = numbersOf(elementWith(markup, 'data-stage-picture'), transform)
    const width = scale * frame.width

    return {
      left: (x / 100) * frame.width,
      top: (y / 100) * frame.height,
      width,
      height: (width * box.height) / box.width,
    }
  }

  // where the mark layer lies, which is laid out in shares of the frame
  function boxOfMarks(markup: string): FrameRect {
    const layout = new RegExp(`left:${share}%;top:${share}%;width:${share}%;height:${share}%`)
    const [left = 0, top = 0, width = 0, height = 0] = numbersOf(elementWith(markup, 'data-stage-marks'), layout)

    return {
      left: (left / 100) * frame.width,
      top: (top / 100) * frame.height,
      width: (width / 100) * frame.width,
      height: (height / 100) * frame.height,
    }
  }

  test.each([
    ['wider', wideBox],
    ['taller', tallBox],
  ])('on a level %s than the frame, the picture and the marks put the box in the same place', (_, box) => {
    const markup = renderOn(box)
    const picture = boxOfPicture(markup, box)
    const marks = boxOfMarks(markup)

    expect(picture.left).toBeCloseTo(marks.left, 6)
    expect(picture.top).toBeCloseTo(marks.top, 6)
    expect(picture.width).toBeCloseTo(marks.width, 6)
    expect(picture.height).toBeCloseTo(marks.height, 6)
  })

  test('the box of a level wider than the frame fills its width and lies in the middle of its height', () => {
    const picture = boxOfPicture(renderOn(wideBox), wideBox)

    expect(picture.left).toBeCloseTo(0)
    expect(picture.width).toBeCloseTo(frame.width)
    expect(picture.top).toBeCloseTo((frame.height - picture.height) / 2)
    expect(picture.top).toBeGreaterThan(0)
  })

  test('the box of a level taller than the frame fills its height and lies in the middle of its width', () => {
    const picture = boxOfPicture(renderOn(tallBox), tallBox)

    expect(picture.top).toBeCloseTo(0)
    expect(picture.height).toBeCloseTo(frame.height)
    expect(picture.left).toBeCloseTo((frame.width - picture.width) / 2)
    expect(picture.left).toBeGreaterThan(0)
  })

  test('a KO’s marker lies on the frame itself, where the picture puts the edge of the bounds the player left by', () => {
    const outRight = { timeMs: 1000, victim: 2, x: 1, y: 0.5 }
    const markup = renderOn(tallBox, outRight.timeMs + 100, [outRight])
    const picture = boxOfPicture(markup, tallBox)
    const place = new RegExp(`left:${share}%;top:${share}%`)
    const [left = 0, top = 0] = numbersOf(elementWith(markup, 'data-ko-marker'), place)

    // the bounds of a tall level end well inside the frame, so the marker isn't on the frame's edge here
    expect(picture.left + picture.width).toBeLessThan(frame.width * 0.95)
    expect((left / 100) * frame.width).toBeCloseTo(picture.left + picture.width, 6)
    expect((top / 100) * frame.height).toBeCloseTo(picture.top + picture.height / 2, 6)
    expect(elementWith(markup, 'data-stage-window')).toContain('data-ko-marker')
    expect(elementWith(markup, 'data-stage-marks')).not.toContain('data-ko-marker')
  })
})

describe('the marker of a KO', () => {
  const outBelow = { timeMs: 1000, victim: 1, x: 0.5, y: 1 }
  const outRight = { timeMs: 1000, victim: 2, x: 1, y: 0.5 }

  const renderKo = (ko: typeof outBelow, box: StageBox, camera = fixedCamera(box)) =>
    renderToStaticMarkup(<KoMarkers kos={[ko]} box={box} camera={camera} timeMs={ko.timeMs + 100} />)

  // where a marker's middle is laid out, in percent of the frame
  function placeOf(markup: string): { left: number; top: number } {
    const place = /left:(-?[\d.]+)%;top:(-?[\d.]+)%/.exec(markup)

    if (!place) throw new Error('no marker in the markup')

    return { left: Number(place[1]), top: Number(place[2]) }
  }

  // the game draws its KO burst at the player's position kept inside the camera bounds, which is the KO's spot
  test('is on the edge of the bounds, inside the frame, where the fixed camera shows a tall level past them', () => {
    const edge = boxInFrame(tallBox, fixedCamera(tallBox))
    const marker = placeOf(renderKo(outRight, tallBox))

    expect(marker.left).toBeCloseTo((edge.x + edge.width) * 100, 6)
    expect(marker.left).toBeCloseTo(93.945, 2)
    expect(marker.top).toBeCloseTo(50, 6)
  })

  test('is kept inside the frame where the bounds’ edge is nearer the frame’s than the marker is big', () => {
    // a wide level's bounds end 1.9% of the frame's height above its bottom under the fixed camera
    expect(renderKo(outBelow, wideBox)).toContain('left:50%;top:97.5%')
    expect(renderKo(outRight, wideBox)).toContain('left:98.5%;top:50%')
  })

  test('is on the frame’s edge while the game’s view lies on the edge of the bounds the player left by', () => {
    // the bottom right quarter of the level, as the game's camera has it when a player goes out there
    const height = wideBox.height / 2
    const width = height * frameAspect
    const view = { x: wideBox.minX + wideBox.width - width, y: wideBox.minY + height, width, height }
    const outRightLow = { ...outRight, y: 0.75 }
    const outBelowRight = { ...outBelow, x: 0.75 }
    const alongBottom = ((wideBox.minX + outBelowRight.x * wideBox.width - view.x) / width) * 100
    const marker = placeOf(renderKo(outBelowRight, wideBox, view))

    expect(renderKo(outRightLow, wideBox, view)).toContain('left:98.5%;top:50%')
    expect(marker.left).toBeCloseTo(alongBottom, 6)
    expect(marker.top).toBe(97.5)
  })

  test('is kept on the frame’s edge on that side while the game’s camera looks elsewhere', () => {
    // the left half of the level's height in the middle: the right edge of the bounds is far outside the frame
    const view = { x: wideBox.minX, y: wideBox.minY + 662.5, width: 1325 * frameAspect, height: 1325 }

    expect(renderKo(outRight, wideBox, view)).toContain('left:98.5%;top:50%')
    expect(renderKo(outBelow, wideBox, view)).toContain('top:97.5%')
  })

  test('is gone a little after the KO', () => {
    const late = <KoMarkers kos={[outBelow]} box={wideBox} camera={fixedCamera(wideBox)} timeMs={3000} />

    expect(renderToStaticMarkup(late)).toBe('')
  })
})

describe('the rings on the stage', () => {
  // a legend's ring is 216 level units across and 80 above the feet: 5% of this box's width, 5% of its height up.
  // on a stage too small for that to show, it stays 32 pixels
  const box: StageBox = { minX: -500, minY: 200, width: 4320, height: 1600 }
  const legends = { box, areLegends: true, tokenSlots: new Set<number>() }
  const tokens = { box, areLegends: false, tokenSlots: new Set<number>() }
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
      <StageViewContext.Provider value={{ bodies, camera: fixedCamera(box) }}>
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

  test('among legends, a player drawn as their portrait is ringed as a token, and the other as a legend', () => {
    const markup = renderMarkers({ ...legends, tokenSlots: new Set([moment.victim]) })

    expect(markup).toContain(aroundToken)
    expect(markup).toContain('left:25%;top:45%;width:max(32px, 5%);aspect-ratio:1')
  })

  test('a hit on a player drawn as their portrait flashes on the portrait', () => {
    const hit = { ...firstHit, x: 0.5, y: 0.5 }
    const bodies = { ...legends, tokenSlots: new Set([hit.target]) }
    const markup = renderToStaticMarkup(<PlayEffects hits={[hit]} bodies={bodies} timeMs={hit.timeMs} />)

    expect(markup).toContain('left:50%;top:calc(50% - 14px);width:min(16px, 2.5%);aspect-ratio:1')
  })

  test('the moment being watched is ringed around the body of whoever gets hit', () => {
    const markup = renderToStaticMarkup(<MomentRing moment={moment} bodies={legends} timeMs={moment.timeMs} />)

    expect(markup).toContain(aroundLegend)
  })

  test('a hit flashes on the target’s body, from a small ring out to the ring around it', () => {
    const hit = { ...firstHit, x: 0.5, y: 0.5 }

    const flashAt = (timeMs: number) =>
      renderToStaticMarkup(<PlayEffects hits={[hit]} bodies={legends} timeMs={timeMs} />)

    expect(flashAt(hit.timeMs)).toContain('left:50%;top:45%;width:max(8px, 1.25%);aspect-ratio:1')
    expect(flashAt(hit.timeMs + 449)).toMatch(/left:50%;top:45%;width:max\(31\.9\d*px, 4\.99\d*%\)/)
  })
})

describe('the stage in fullscreen', () => {
  test('is as wide as the screen, or as its height allows at the game’s 16:9', () => {
    const markup = renderToStaticMarkup(
      <StageFrame frameRef={{ current: null }} fullscreen={filledScreen} controls={shownControls}>
        <span />
      </StageFrame>,
    )

    expect(markup).toContain(`width:min(100%, calc(100dvh * ${16 / 9}))`)
  })

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
