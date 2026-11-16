import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract, StageBox } from '@brawltome/contracts'
import type { Bubble, CameraTrack, PlayerPose, Replay, Timeline } from '@brawltome/replay-player'
import { formatClock } from '../src/components/match/match-format'
import { damageColour } from '../src/components/match/match-styles'
import { isCameraMode } from '../src/components/match/stage/camera-mode'
import { bubblePose, bubblesBySlot, intoBubble } from '../src/components/match/stage/offscreen-bubbles'
import { cameraOf, inFrame, levelToCanvas, viewOf, wholeStage } from '../src/components/match/stage/play-camera'
import { readPlaybackTimeline, stepAt } from '../src/components/match/stage/playback-timeline'
import { posesAt, valueAt } from '../src/components/match/stage/pose'
import { cameraNow, cameraPathKey } from '../src/components/match/stage/stage-camera'
import { tagLifts } from '../src/components/match/stage/tag-stack'
import { mixCameras } from '../src/components/match/stage/use-camera-blend'
import { initialLegends, type Legends, legendsStateOf } from '../src/components/match/stage/use-legends'
import { weaponIconName } from '../src/components/match/weapon-icon'
import { readInsights, readPlayback } from './match-fixtures'

type Art = MatchDetailContract['art']

const box: StageBox = { minX: -1000, minY: -500, width: 4000, height: 2250 }
const manifestUrl = 'https://art.test/manifests/match.json'
const baseUrl = 'https://art.test/'

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

describe('the camera', () => {
  test('a view of the whole box shows the whole stage', () => {
    expect(cameraOf({ x: box.minX, y: box.minY, width: box.width, height: box.height }, box)).toEqual(wholeStage)
  })

  test('a view half the size in the middle doubles the stage around its middle', () => {
    const rect = {
      x: box.minX + box.width / 4,
      y: box.minY + box.height / 4,
      width: box.width / 2,
      height: box.height / 2,
    }

    expect(cameraOf(rect, box)).toEqual({ x: 0.25, y: 0.25, zoom: 2 })
    expect(viewOf(box, cameraOf(rect, box))).toEqual(rect)
  })

  test('a view past the box is kept inside it', () => {
    const rect = { x: box.minX - 500, y: box.minY, width: box.width / 2, height: box.height / 2 }

    expect(cameraOf(rect, box).x).toBe(0)
  })

  test('the canvas matrix takes the box’s corners to the canvas’s corners on the whole stage', () => {
    const [scaleX, , , scaleY, offsetX, offsetY] = levelToCanvas(box, wholeStage, 800, 450)

    expect(box.minX * scaleX + offsetX).toBeCloseTo(0)
    expect((box.minX + box.width) * scaleX + offsetX).toBeCloseTo(800)
    expect(box.minY * scaleY + offsetY).toBeCloseTo(0)
  })

  test('a spot moves into the frame the camera shows', () => {
    expect(inFrame({ x: 0.5, y: 0.5 }, { x: 0.25, y: 0.25, zoom: 2 })).toEqual({ x: 0.5, y: 0.5 })
  })

  test('a glide starts on one camera, ends on the other, and zooms by equal ratios', () => {
    const from = wholeStage
    const to = { x: 0.375, y: 0.375, zoom: 4 }

    expect(mixCameras(from, to, 0)).toEqual(from)
    expect(mixCameras(from, to, 1)).toEqual(to)
    expect(mixCameras(from, to, 0.5).zoom).toBeCloseTo(2)
  })

  test('the game camera shows the track’s view once the legends are in, and the whole stage before', () => {
    const insights = readInsights('duel-a')
    const { stage } = insights.insights
    const timeline = readPlaybackTimeline(readPlayback('duel-a'))
    const half = { x: stage.box.minX, y: stage.box.minY, width: stage.box.width / 2, height: stage.box.height / 2 }
    const track: CameraTrack = { steps: new Float64Array(), at: () => half }
    const ready: Legends = { replay: null, timeline, track, state: 'ready', isDownloading: false }
    const loading: Legends = { ...ready, state: 'loading' }

    expect(cameraNow({ mode: 'game', legends: ready, stage }, 1000)).toEqual({ x: 0, y: 0, zoom: 2 })
    expect(cameraNow({ mode: 'stage', legends: ready, stage }, 1000)).toEqual(wholeStage)
    expect(cameraNow({ mode: 'game', legends: loading, stage }, 1000)).toEqual(wholeStage)

    expect(cameraPathKey({ mode: 'game', legends: loading, stage })).not.toBe(
      cameraPathKey({ mode: 'game', legends: ready, stage }),
    )
  })

  test('only Game and Fixed are camera modes', () => {
    expect(isCameraMode('game')).toBe(true)
    expect(isCameraMode('stage')).toBe(true)
    expect(isCameraMode('follow')).toBe(false)
  })
})

describe('the legends’ state', () => {
  const loading = { status: 'loading' } as const
  const loaded = <Value>(value: Value) => ({ status: 'loaded', value }) as const
  const replay = {} as Replay
  const timeline = {} as Timeline

  test('art shows whenever there is a manifest, whatever the export’s state', () => {
    for (const state of ['none', 'queued', 'ready', 'failed'] as const) {
      expect(initialLegends(art(state, true)).state).toBe('loading')
      expect(legendsStateOf(art(state, true), loaded(replay), loaded(timeline))).toBe('ready')
    }
  })

  test('without a manifest, failed or missing art is unavailable and queued art is on its way', () => {
    expect(initialLegends(art('failed', false)).state).toBe('unavailable')
    expect(initialLegends(art('none', false)).state).toBe('unavailable')
    expect(initialLegends(art('queued', false)).state).toBe('loading')
    expect(initialLegends(art('queued', false)).isDownloading).toBe(false)
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
