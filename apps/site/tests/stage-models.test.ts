import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract, StageBox } from '@brawltome/contracts'
import {
  type Bubble,
  type CameraTrack,
  cameraAt,
  cameraTrack,
  type PlayerPose,
  type Rect,
  type Replay,
  type Timeline,
} from '@brawltome/replay-player'
import { formatClock } from '../src/components/match/match-format'
import { damageColour } from '../src/components/match/match-styles'
import { artBoxOf } from '../src/components/match/stage/art-box'
import {
  bodyMiddle,
  bodyPxOf,
  bodyRingDiameter,
  bodyRingStyle,
  drawnBodiesOf,
  legendRingFloorPx,
} from '../src/components/match/stage/body-ring'
import { isCameraMode } from '../src/components/match/stage/camera-mode'
import { placedArtOf } from '../src/components/match/stage/map-art'
import { missingPosesInFrame } from '../src/components/match/stage/missing-poses'
import { bubblePose, bubblesBySlot, intoBubble } from '../src/components/match/stage/offscreen-bubbles'
import {
  boxInFrame,
  cameraOn,
  fixedCamera,
  frameAspect,
  inFrame,
  unitInFrame,
} from '../src/components/match/stage/play-camera'
import { readPlaybackTimeline, stepAt } from '../src/components/match/stage/playback-timeline'
import { type Pose, posesAt, valueAt } from '../src/components/match/stage/pose'
import { cameraNow, cameraPathKey } from '../src/components/match/stage/stage-camera'
import { portraitTagLiftPx, tagFeet, tagHeightPx, tagLifts } from '../src/components/match/stage/tag-stack'
import { mixCameras } from '../src/components/match/stage/use-camera-blend'
import {
  areLegendsDrawn,
  initialLegends,
  type Legends,
  legendsStateOf,
} from '../src/components/match/stage/use-legends'
import { frameElapsedMs } from '../src/components/match/stage/use-playback'
import { weaponIconName } from '../src/components/match/weapon-icon'
import { readInsights, readPlayback } from './match-fixtures'

type Art = MatchDetailContract['art']

const box: StageBox = { minX: -1000, minY: -500, width: 4000, height: 2250 }
const manifestUrl = 'https://art.test/manifests/match.json'
const baseUrl = 'https://art.test/'
const playbackPath = '/match/6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f/playback/main-1/1'

function art(state: Art['state'], hasManifest: boolean): Art {
  return hasManifest ? { state, manifestUrl, baseUrl } : { state, manifestUrl: null, baseUrl: null }
}

describe('reading the playback timeline', () => {
  test('a line without a clock at step 0 leaves the field out, so the player draws no tints', () => {
    const served = { ...(readPlayback('duel-a') as object), stepZeroTime: null }

    expect('stepZeroTime' in readPlaybackTimeline(served)).toBe(false)
    expect(readPlaybackTimeline(readPlayback('duel-a')).stepZeroTime).toBe(16)
  })

  test('a timeline of another shape is refused', () => {
    expect(() => readPlaybackTimeline({ format: 2 })).toThrow('read playback timeline')
  })

  test('the clock counts from the first step', () => {
    const timeline = readPlaybackTimeline(readPlayback('duel-a'))

    expect(stepAt(timeline, 0)).toBe(timeline.startStep)
    expect(stepAt(timeline, 160)).toBe(timeline.startStep + 10)
  })
})

describe('poses', () => {
  test('a list of changes holds its last value at or before a step', () => {
    const changes: [number, string][] = [
      [10, 'a'],
      [20, 'b'],
    ]

    expect(valueAt(changes, 5, 'none')).toBe('none')
    expect(valueAt(changes, 10, 'none')).toBe('a')
    expect(valueAt(changes, 19.5, 'none')).toBe('a')
    expect(valueAt(changes, 30, 'none')).toBe('b')
    expect(valueAt(undefined, 30, 'none')).toBe('none')
  })

  test.each(['duel-a', 'doubles-b'] as const)('in %s each KO takes a stock and the player out of play', (name) => {
    const insights = readInsights(name)
    const timeline = readPlaybackTimeline(readPlayback(name))
    const { box: stageBox, stepMs } = insights.insights.stage

    for (const knockout of insights.insights.knockouts) {
      const before = posesAt(timeline, stageBox, knockout.timeMs - stepMs).find((pose) => pose.slot === knockout.victim)
      const after = posesAt(timeline, stageBox, knockout.timeMs).find((pose) => pose.slot === knockout.victim)

      expect(before?.isInPlay).toBe(true)
      expect(before?.damage).toBeCloseTo(knockout.damage, 1)
      expect(after?.isInPlay).toBe(false)
      expect(after?.stocksLeft).toBe((before?.stocksLeft ?? 0) - 1)
    }
  })

  test('every player stands in the stage box at the start, in the order of their slots', () => {
    const insights = readInsights('doubles-b')
    const poses = posesAt(readPlaybackTimeline(readPlayback('doubles-b')), insights.insights.stage.box, 0)

    expect(poses.map((pose) => pose.slot)).toEqual([1, 2, 3, 4])

    for (const pose of poses) {
      expect(pose.x).toBeGreaterThan(0)
      expect(pose.x).toBeLessThan(1)
      expect(pose.y).toBeGreaterThan(0)
      expect(pose.y).toBeLessThan(1)
      expect(pose.stocksLeft).toBe(3)
    }
  })
})

// the same rectangle, give or take the last bits of a float
function expectCamera(camera: Rect, wanted: Rect) {
  expect(camera.x).toBeCloseTo(wanted.x, 6)
  expect(camera.y).toBeCloseTo(wanted.y, 6)
  expect(camera.width).toBeCloseTo(wanted.width, 6)
  expect(camera.height).toBeCloseTo(wanted.height, 6)
}

function middleOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

describe('the camera', () => {
  const wholeBox = { x: box.minX, y: box.minY, width: box.width, height: box.height }
  // Shiganshina District's camera bounds are wider than the game's screen, Twilight Grove's taller
  const wideBox: StageBox = { minX: -750, minY: -750, width: 4900, height: 2650 }
  const tallBox: StageBox = { minX: -2371, minY: -1300, width: 4742.15, height: 3035 }

  test('the frame has the shape of the game’s screen', () => {
    expect(frameAspect).toBe(1920 / 1080)
  })

  test('a view of the frame’s shape, as the game’s are, is shown as it is', () => {
    const view = { x: 100, y: 50, width: 3200, height: 1800 }

    expectCamera(cameraOn(view), view)
  })

  test('the fixed camera shows a level of the frame’s shape whole and no more', () => {
    expectCamera(fixedCamera(box), wholeBox)
  })

  test.each([
    ['wider', wideBox],
    ['taller', tallBox],
  ])('the fixed camera shows a level %s than the frame whole, in the middle of the frame', (_, level) => {
    const camera = fixedCamera(level)
    const bounds = { x: level.minX, y: level.minY, width: level.width, height: level.height }

    expect(camera.width / camera.height).toBeCloseTo(frameAspect)
    expect(camera.width).toBeGreaterThanOrEqual(level.width)
    expect(camera.height).toBeGreaterThanOrEqual(level.height)
    expect(Math.min(camera.width - level.width, camera.height - level.height)).toBeCloseTo(0)
    expect(middleOf(camera).x).toBeCloseTo(middleOf(bounds).x)
    expect(middleOf(camera).y).toBeCloseTo(middleOf(bounds).y)
  })

  test('the stage box lies in the frame where the camera puts it, and its spots with it', () => {
    const middleHalf = {
      x: box.minX + box.width / 4,
      y: box.minY + box.height / 4,
      width: box.width / 2,
      height: box.height / 2,
    }

    expect(boxInFrame(box, middleHalf)).toEqual({ x: -0.5, y: -0.5, width: 2, height: 2 })
    expect(inFrame({ x: 0.5, y: 0.5 }, box, middleHalf)).toEqual({ x: 0.5, y: 0.5 })
    expect(inFrame({ x: 0.25, y: 0.75 }, box, middleHalf)).toEqual({ x: 0, y: 1 })
  })

  test('on a level wider than the frame, the game’s widest view fills the frame and the box runs past its sides', () => {
    const widest = { x: -655.5, y: -750, width: 2650 * frameAspect, height: 2650 }
    const place = boxInFrame(wideBox, widest)

    expect(place.height).toBeCloseTo(1)
    expect(place.width).toBeCloseTo(4900 / 4711.11, 4)
    expect(place.x).toBeLessThan(0)
    expect(place.x + place.width).toBeGreaterThan(1)
  })

  test('a level unit is as wide in the frame as the camera makes it', () => {
    expect(unitInFrame(fixedCamera(box))).toBeCloseTo(1 / box.width)
    expect(unitInFrame({ ...wholeBox, width: box.width / 2, height: box.height / 2 })).toBeCloseTo(2 / box.width)
  })

  test('a glide starts on one camera, ends on the other, and zooms by equal ratios', () => {
    const from = fixedCamera(box)
    const to = { x: 500, y: 300, width: box.width / 4, height: box.height / 4 }
    const halfway = mixCameras(from, to, 0.5)

    expectCamera(mixCameras(from, to, 0), from)
    expectCamera(mixCameras(from, to, 1), to)
    expect(halfway.width).toBeCloseTo(box.width / 2)
    expect(halfway.width / halfway.height).toBeCloseTo(frameAspect)
    expect(middleOf(halfway).x).toBeCloseTo((middleOf(from).x + middleOf(to).x) / 2)
  })

  test('the game camera shows the track’s view once the legends are in, and the whole stage before', () => {
    const insights = readInsights('duel-a')
    const { stage } = insights.insights
    const timeline = readPlaybackTimeline(readPlayback('duel-a'))
    const half = { x: stage.box.minX, y: stage.box.minY, width: stage.box.width / 2, height: stage.box.height / 2 }
    const empty = new Float64Array()
    const track: CameraTrack = { steps: empty, frameTimes: empty, frameViews: empty, at: () => half }

    const ready: Legends = {
      replay: null,
      timeline,
      track,
      state: 'ready',
      isDownloading: false,
      missingSlots: new Set(),
    }

    const loading: Legends = { ...ready, state: 'loading' }
    const wholeStage = fixedCamera(stage.box)

    expectCamera(cameraNow({ mode: 'game', legends: ready, stage }, 1000), half)
    expectCamera(cameraNow({ mode: 'stage', legends: ready, stage }, 1000), wholeStage)
    expectCamera(cameraNow({ mode: 'game', legends: loading, stage }, 1000), wholeStage)

    expect(cameraPathKey({ mode: 'game', legends: loading, stage })).not.toBe(
      cameraPathKey({ mode: 'game', legends: ready, stage }),
    )
  })

  test.each([
    ['of the frame’s shape', box],
    ['wider than the frame', wideBox],
    ['taller than the frame', tallBox],
  ])('in a level %s, every view of the game’s camera has the frame’s shape and lies in the bounds', (_, level) => {
    const timeline = readPlaybackTimeline(readPlayback('duel-a'))
    const bounds = { x: level.minX, y: level.minY, width: level.width, height: level.height }
    const track = cameraTrack(timeline, bounds, { fps: 60 })

    for (let step = timeline.startStep; step <= timeline.endStep; step += 30) {
      const view = cameraAt(track, step)

      if (!view) throw new Error(`the camera has no view at step ${step}`)

      expect(view.width / view.height).toBeCloseTo(frameAspect, 6)
      expect(view.x).toBeGreaterThanOrEqual(bounds.x - 0.001)
      expect(view.y).toBeGreaterThanOrEqual(bounds.y - 0.001)
      expect(view.x + view.width).toBeLessThanOrEqual(bounds.x + bounds.width + 0.001)
      expect(view.y + view.height).toBeLessThanOrEqual(bounds.y + bounds.height + 0.001)
      expectCamera(cameraOn(view), view)
    }
  })

  test('only Game and Fixed are camera modes', () => {
    expect(isCameraMode('game')).toBe(true)
    expect(isCameraMode('stage')).toBe(true)
    expect(isCameraMode('follow')).toBe(false)
  })
})

describe('the ring around a player’s body', () => {
  // the game's standing hurtbox, the same for every legend
  const hurtbox = { width: 145, height: 160 }
  const anyBox: StageBox = { minX: -500, minY: 200, width: 4320, height: 1600 }
  const noSlots: ReadonlySet<number> = new Set()
  const legends = { box: anyBox, areLegends: true, tokenSlots: noSlots }
  const tokens = { box: anyBox, areLegends: false, tokenSlots: noSlots }

  test('holds a legend’s whole standing hurtbox, and is no bigger than that takes', () => {
    const diagonal = Math.hypot(hurtbox.width, hurtbox.height)

    expect(bodyMiddle).toBe(hurtbox.height / 2)
    expect(bodyRingDiameter).toBeGreaterThanOrEqual(diagonal)
    expect(bodyRingDiameter - diagonal).toBeLessThan(1)
  })

  test('around a legend it is placed in level units: its middle the body’s, over the feet', () => {
    const whole = { left: '50%', top: '45%', width: 'max(32px, 5%)', aspectRatio: '1' }

    expect(bodyRingStyle({ x: 0.5, y: 0.5 }, legends, 1)).toEqual(whole)
    expect(bodyRingStyle({ x: 0.5, y: 0.5 }, legends, 1, 0.25)).toEqual({ ...whole, width: 'max(8px, 1.25%)' })
  })

  test('around a legend it never gets too small to show beside the numbers of a stop’s hits', () => {
    // size-4 on a hit's number
    const hitNumberPx = 16

    expect(legendRingFloorPx).toBeGreaterThan(hitNumberPx)
    expect(bodyRingStyle({ x: 0.5, y: 0.5 }, legends, 1).width).toBe(`max(${legendRingFloorPx}px, 5%)`)
  })

  test('around a token it is as big on every stage, and smaller on a phone’s', () => {
    expect(bodyRingStyle({ x: 0.5, y: 0.5 }, tokens, 1)).toEqual({
      left: '50%',
      top: 'calc(50% - 14px)',
      width: 'min(64px, 10%)',
      aspectRatio: '1',
    })
  })

  test('on a stage as laid out, a legend’s ring and tag grow with the level unit and a token’s don’t', () => {
    expect(bodyPxOf(legends, 0.5, 1)).toEqual({ ringMiddlePx: 40, ringRadiusPx: 54, tagTopPx: 115 })
    expect(bodyPxOf(tokens, 0.5, 1)).toEqual(bodyPxOf(tokens, 2, 1))
  })

  test('on a stage as laid out, a legend’s ring is as big as it is drawn where the stage is small', () => {
    // on a 390 pixel stage this box makes the ring through the hurtbox's corners 19.5 pixels, under its smallest size
    const unitPx = 390 / anyBox.width

    expect(bodyPxOf(legends, unitPx, 1).ringRadiusPx).toBe(legendRingFloorPx / 2)
    expect(bodyPxOf(legends, unitPx, 1).ringMiddlePx).toBeCloseTo(80 * unitPx)
  })

  test('on a stage as laid out, a token’s ring is as big as it is drawn: a tenth of a small stage', () => {
    expect(bodyPxOf(tokens, 1000 / anyBox.width, 1).ringRadiusPx).toBe(32)
    expect(bodyPxOf(tokens, 390 / anyBox.width, 1).ringRadiusPx).toBeCloseTo(19.5)
  })

  test('around a player drawn as their portrait among legends it is a token’s, and the others keep a legend’s', () => {
    const withPortrait = { ...legends, tokenSlots: new Set([2]) }
    const feet = { x: 0.5, y: 0.5 }

    expect(bodyRingStyle(feet, withPortrait, 2)).toEqual(bodyRingStyle(feet, tokens, 2))
    expect(bodyRingStyle(feet, withPortrait, 1)).toEqual(bodyRingStyle(feet, legends, 1))
  })

  test('on a stage as laid out, a portrait among legends has a token’s ring and its tag over the portrait', () => {
    const withPortrait = { ...legends, tokenSlots: new Set([2]) }
    // a phone's stage under the fixed camera, where a legend's head is lower than the portrait's top
    const phoneUnitPx = 0.13
    const portrait = bodyPxOf(withPortrait, phoneUnitPx, 2)
    const token = bodyPxOf(tokens, phoneUnitPx, 2)

    expect(portrait.ringMiddlePx).toBe(token.ringMiddlePx)
    expect(portrait.ringRadiusPx).toBe(token.ringRadiusPx)
    expect(portrait.tagTopPx).toBe(portraitTagLiftPx + tagHeightPx)
    expect(bodyPxOf(withPortrait, phoneUnitPx, 1)).toEqual(bodyPxOf(legends, phoneUnitPx, 1))
    // where the camera is close in, the tag goes as high as a legend's
    expect(bodyPxOf(withPortrait, 0.5, 2).tagTopPx).toBe(bodyPxOf(legends, 0.5, 1).tagTopPx)
  })

  test('the players whose art can’t load are drawn as tokens among the legends', () => {
    const stage = readInsights('duel-a').insights.stage

    const ready: Legends = {
      replay: {} as Replay,
      timeline: {} as Timeline,
      track: null,
      state: 'ready',
      isDownloading: false,
      missingSlots: new Set([2]),
    }

    expect(drawnBodiesOf(stage, ready)).toEqual({ box: stage.box, areLegends: true, tokenSlots: new Set([2]) })
  })

  test('the players are drawn as their legends once the art and the timeline are in', () => {
    const ready: Legends = {
      replay: {} as Replay,
      timeline: {} as Timeline,
      track: null,
      state: 'ready',
      isDownloading: false,
      missingSlots: new Set(),
    }

    expect(areLegendsDrawn(ready)).toBe(true)
    expect(areLegendsDrawn({ ...ready, state: 'loading' })).toBe(false)
    expect(areLegendsDrawn({ ...ready, replay: null })).toBe(false)
  })
})

describe('the legends’ state', () => {
  const loading = { status: 'loading' } as const
  const loaded = <Value>(value: Value) => ({ status: 'loaded', value }) as const
  const replay = {} as Replay
  const timeline = {} as Timeline

  test('art shows whenever there is a manifest, whatever the export’s state', () => {
    for (const state of ['none', 'queued', 'ready', 'failed'] as const) {
      expect(initialLegends(art(state, true), playbackPath).state).toBe('loading')
      expect(legendsStateOf(art(state, true), loaded(replay), loaded(timeline))).toBe('ready')
    }
  })

  test('without a manifest, failed or missing art is unavailable and queued art is still being drawn', () => {
    expect(initialLegends(art('failed', false), playbackPath).state).toBe('unavailable')
    expect(initialLegends(art('none', false), playbackPath).state).toBe('unavailable')
    expect(initialLegends(art('queued', false), playbackPath).state).toBe('drawing')
    expect(initialLegends(art('queued', false), playbackPath).isDownloading).toBe(false)
  })

  test('a match without a timeline downloads no art, as nothing could play it', () => {
    const legends = initialLegends(art('ready', true), null)

    expect(legends.state).toBe('unavailable')
    expect(legends.isDownloading).toBe(false)
  })

  test('art or a timeline that fails to load makes the legends unavailable', () => {
    const failed = { status: 'failed' } as const

    expect(legendsStateOf(art('ready', true), failed, loaded(timeline))).toBe('unavailable')
    expect(legendsStateOf(art('ready', true), loaded(replay), failed)).toBe('unavailable')
    expect(legendsStateOf(art('ready', true), loaded(replay), loading)).toBe('loading')
  })
})

describe('off-screen bubbles', () => {
  const pose: PlayerPose = { animationIndex: 0, frame: 0, facingRight: true, x: 10, y: 20, weapon: 'Unarmed' }

  test('a player without a bubble is drawn where they are', () => {
    expect(intoBubble(pose, undefined)).toBe(pose)
  })

  test('a player with a bubble is drawn in it, and the bubble’s art fades with it', () => {
    const bubble = { slot: '1', x: 5, y: 6, angle: 0, alpha: 0.5, player: { x: 7, y: 8 }, zoom: 1 } as Bubble

    expect(intoBubble(pose, bubble)).toMatchObject({ x: 7, y: 8, weapon: 'Unarmed' })
    expect(bubblePose(bubble, 54)).toMatchObject({ animationIndex: 54, look: '-', alpha: 0.5, behind: false })
  })

  test('a view of a corner of the stage puts the players out of it in bubbles', () => {
    const timeline = readPlaybackTimeline(readPlayback('duel-a'))
    const step = stepAt(timeline, 20_000)
    const corner = { x: -100_000, y: -100_000, width: 10, height: 10 }

    expect([...bubblesBySlot(timeline, corner, step).keys()]).toEqual(['1', '2'])
  })
})

describe('a player whose art can’t load', () => {
  const insights = readInsights('duel-a')
  const stageBox = insights.insights.stage.box
  const timeline = readPlaybackTimeline(readPlayback('duel-a'))
  const timeMs = 20_000
  const poses = posesAt(timeline, stageBox, timeMs)
  const missing = new Set([2])

  test('stands where their legend would, in view, and no one else does', () => {
    const camera = fixedCamera(stageBox)
    const placed = missingPosesInFrame(poses, missing, timeline, stageBox, camera, timeMs)
    const own = poses.find((pose) => pose.slot === 2)

    expect(own).toBeDefined()
    expect(placed).toEqual([inFrame(own as Pose, stageBox, camera)])
  })

  test('out of view, stands in their bubble at the frame’s edge, as their legend would', () => {
    const corner = cameraOn({
      x: stageBox.minX,
      y: stageBox.minY,
      width: stageBox.width / 4,
      height: stageBox.height / 4,
    })

    const [placed] = missingPosesInFrame(poses, missing, timeline, stageBox, corner, timeMs)
    const own = inFrame(poses.find((pose) => pose.slot === 2) as Pose, stageBox, corner)

    expect(placed.slot).toBe(2)
    expect(own.x > 1 || own.y > 1).toBe(true)
    expect(placed.x).toBeGreaterThanOrEqual(0)
    expect(placed.x).toBeLessThanOrEqual(1)
    expect(placed.y).toBeGreaterThanOrEqual(0)
    expect(placed.y).toBeLessThanOrEqual(1)
  })

  test('with no one missing, there is no one to place', () => {
    expect(missingPosesInFrame(poses, new Set(), timeline, stageBox, fixedCamera(stageBox), timeMs)).toEqual([])
  })
})

describe('tags over players', () => {
  const at = (slot: number, x: number, y: number) =>
    ({
      slot,
      x,
      y,
      isInPlay: true,
      facingRight: true,
      weapon: 'Unarmed',
      isHitstun: false,
      isDodging: false,
      damage: 0,
      stocksLeft: 3,
    }) as const

  test('players on one spot get their tags one over the other, in the order of their slots', () => {
    const lifts = tagLifts([at(2, 0.5, 0.5), at(1, 0.5, 0.5)], { width: 800, height: 450 })

    expect(lifts.get(1)).toBe(0)
    expect(lifts.get(2)).toBe(1)
  })

  test('a portrait’s tag sits over the portrait where a legend’s head is lower, and stacks with a legend’s', () => {
    const phone = { width: 390, height: 219 }
    // a legend's tag 25 pixels over the feet, inside the portrait on the same spot
    const legendRaise = 25 / phone.height
    const tags = tagFeet([at(1, 0.5, 0.5)], [at(2, 0.5, 0.5)], legendRaise, phone)
    const lifts = tagLifts(tags, phone)
    const raisedPx = (slot: number) => (0.5 - (tags.find((tag) => tag.slot === slot)?.y ?? 0)) * phone.height

    expect(raisedPx(1)).toBeCloseTo(25)
    expect(raisedPx(2)).toBeCloseTo(portraitTagLiftPx)
    expect(lifts.get(1)).toBe(0)
    expect(lifts.get(2)).toBe(1)
  })

  test('a portrait’s tag goes as high as a legend’s where the legend’s head is higher', () => {
    const frame = { width: 1440, height: 810 }
    const legendRaise = 60 / frame.height
    const [legend, portrait] = tagFeet([at(1, 0.2, 0.5)], [at(2, 0.8, 0.5)], legendRaise, frame)

    expect(portrait.y).toBe(legend.y)
  })

  test('players apart keep their tags level', () => {
    const lifts = tagLifts([at(1, 0.1, 0.5), at(2, 0.9, 0.5)], { width: 800, height: 450 })

    expect([lifts.get(1), lifts.get(2)]).toEqual([0, 0])
  })
})

describe('what the stage shows of a player', () => {
  test('weapons get their icon, thrown ones too, and anything else none', () => {
    expect(weaponIconName('RocketLance')).toBe('Lance')
    expect(weaponIconName('ThrowLance')).toBe('Lance')
    expect(weaponIconName('Fists')).toBe('Gauntlets')
    expect(weaponIconName('Bomb')).toBe(null)
  })

  test('damage climbs from white to dark red', () => {
    expect(damageColour(0)).toBe('rgb(226 232 240)')
    expect(damageColour(500)).toBe('rgb(112 18 34)')
  })

  test('the clock reads in minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(168_832)).toBe('2:49')
  })
})

describe('the clock', () => {
  test('moves by the time since the last frame, and no more than a frame’s worth after the tab was hidden', () => {
    expect(frameElapsedMs(1000, null)).toBe(0)
    expect(frameElapsedMs(1016, 1000)).toBe(16)
    expect(frameElapsedMs(61_000, 1000)).toBe(100)
  })
})

describe('platform art', () => {
  const piece = (file: string) => ({ file, x: 0.1, y: 0.5, width: 0.3, height: 0.2, rotation: 0 })
  const urls: Record<string, string> = { 'Space.Platform_Space1.png': 'https://art.test/sheets/10a43fccdae5677c.webp' }

  test('a piece whose file the map file names gets its image; one without is skipped', () => {
    const placed = placedArtOf(
      [piece('Space.Platform_Space1.png'), piece('Space.Missing.png')],
      (file) => urls[file] ?? null,
    )

    expect(placed).toEqual([{ ...piece('Space.Platform_Space1.png'), url: urls['Space.Platform_Space1.png'] }])
  })

  test('a piece whose image lies outside the art store is skipped too', () => {
    const outside = () => {
      throw new Error('outside the art store')
    }

    expect(placedArtOf([piece('Space.Platform_Space1.png')], outside)).toEqual([])
  })
})

describe('where a platform’s image is drawn', () => {
  const drawing = { width: 160, height: 90 }
  const piece = { file: 'Space.Platform_Space1.png', x: 0.25, y: 0.5, width: 0.5, height: 0.2, rotation: 10 }

  test('a piece lies from its corner over its size, turned about that corner', () => {
    expect(artBoxOf(piece, drawing)).toEqual({ x: 40, y: 45, width: 80, height: 18, transform: 'rotate(10 40 45)' })
  })

  test('a negative width flips the image over its corner, so it reaches left of it', () => {
    expect(artBoxOf({ ...piece, width: -0.5 }, drawing)).toEqual({
      x: 40,
      y: 45,
      width: 80,
      height: 18,
      transform: 'rotate(10 40 45) translate(40 45) scale(-1 1) translate(-40 -45)',
    })
  })

  test('a negative height flips it upwards, and both flip it both ways', () => {
    expect(artBoxOf({ ...piece, height: -0.2 }, drawing).transform).toBe(
      'rotate(10 40 45) translate(40 45) scale(1 -1) translate(-40 -45)',
    )

    expect(artBoxOf({ ...piece, width: -0.5, height: -0.2 }, drawing)).toEqual({
      x: 40,
      y: 45,
      width: 80,
      height: 18,
      transform: 'rotate(10 40 45) translate(40 45) scale(-1 -1) translate(-40 -45)',
    })
  })
})
