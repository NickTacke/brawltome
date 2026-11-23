import { describe, expect, test } from 'bun:test'
import { cameraAt, cameraTrack, type Rect, type Timeline } from '..'
import { CAMERA, cameraInputs, framedItems, GameCamera } from '../src/camera.ts'

const bounds: Rect = { x: -1500, y: -1000, width: 5000, height: 3000 }

// two players over 2000 steps, sampled every 4: one runs far off the right of the bounds and falls below them, the
// other stays near the middle
function twoPlayerTimeline(): Timeline {
  const samples = 501
  const runner = { from: 0, x: [] as number[], y: [] as number[] }
  const stayer = { from: 0, x: [] as number[], y: [] as number[] }

  for (let sample = 0; sample < samples; sample++) {
    runner.x.push(-1200 + sample * 20)
    runner.y.push(sample < 250 ? 600 : 600 + (sample - 250) * 30)
    stayer.x.push(800 + Math.sin(sample / 10) * 300)
    stayer.y.push(600)
  }

  return {
    stepMs: 16,
    startStep: 0,
    endStep: (samples - 1) * 4,
    animations: [],
    state: { '1': { animation: [], status: [[0, 'live']] }, '2': { animation: [], status: [[0, 'live']] } },
    positions: { every: 4, '1': runner, '2': stayer },
  }
}

test('cameraAt stays inside the camera bounds', () => {
  const timeline = twoPlayerTimeline()
  const track = cameraTrack(timeline, bounds)
  const epsilon = 1e-6

  for (let step = 0; step <= timeline.endStep; step += 0.5) {
    const view = cameraAt(track, step)

    if (!view) throw new Error(`no camera at step ${step}`)

    expect(view.x).toBeGreaterThanOrEqual(bounds.x - epsilon)
    expect(view.y).toBeGreaterThanOrEqual(bounds.y - epsilon)
    expect(view.x + view.width).toBeLessThanOrEqual(bounds.x + bounds.width + epsilon)
    expect(view.y + view.height).toBeLessThanOrEqual(bounds.y + bounds.height + epsilon)
  }
})

// two players over 3000 steps, sampled every 4, in whole numbers only so the track is the same on every machine: one
// runs out to the right and back, the other climbs and drops near the middle and is knocked out once
function zigzagTimeline(): Timeline {
  const samples = 751
  const runner = { from: 0, x: [] as number[], y: [] as number[] }
  const climber = { from: 0, x: [] as number[], y: [] as number[] }

  for (let sample = 0; sample < samples; sample++) {
    const lap = sample % 300
    const out = lap < 150 ? lap : 300 - lap

    runner.x.push(-900 + out * 18)
    runner.y.push(600)
    climber.x.push(-400 + (sample % 7) * 3)
    climber.y.push(600 - (out % 50) * 12)
  }

  const knockedOut: [number, string][] = [
    [0, 'live'],
    [1400, 'ko'],
    [1500, 'respawning'],
    [1560, 'live'],
  ]

  return {
    stepMs: 16,
    startStep: 0,
    endStep: (samples - 1) * 4,
    animations: [],
    state: { '1': { animation: [], status: [[0, 'live']] }, '2': { animation: [], status: knockedOut } },
    positions: { every: 4, '1': runner, '2': climber },
  }
}

const floor: Rect = { x: -1200, y: 500, width: 4000, height: 300 }

const sha256 = (steps: Float64Array) =>
  new Bun.CryptoHasher('sha256').update(new Uint8Array(steps.buffer)).digest('hex')

const viewAt = (steps: Float64Array, step: number) => [...steps.subarray(step * 4, step * 4 + 4)]

describe('cameraTrack at 1x', () => {
  // the hashes are of the tracks as they were before a track took a speed
  test('is the track it was before it took a speed, byte for byte', () => {
    const everyStep = cameraTrack(zigzagTimeline(), bounds, { floor })
    const at60 = cameraTrack(zigzagTimeline(), bounds, { floor, fps: 60 })

    expect(sha256(everyStep.steps)).toBe('e32ecd9b1e160ca678465c8014f5dbf3171e98170642e1514d2055767c44bbc5')
    expect(sha256(at60.steps)).toBe('564016297d468d4a206b20c5952402abb4354d2bfbe6bd0ce12d906c79a31d2e')
  })

  test('is the same with the speed given as 1', () => {
    const timeline = zigzagTimeline()

    expect(cameraTrack(timeline, bounds, { floor, speed: 1 }).steps).toEqual(
      cameraTrack(timeline, bounds, { floor }).steps,
    )

    expect(cameraTrack(timeline, bounds, { floor, fps: 60, speed: 1 }).steps).toEqual(
      cameraTrack(timeline, bounds, { floor, fps: 60 }).steps,
    )
  })
})

// the game's loop, played a frame at a time on a screen whose frames last frameMs: a frame reads the real clock in
// whole milliseconds, runs the steps its replay clock has reached, then updates the camera once, with the last of them
// and the real clock
function playedFrameByFrame(timeline: Timeline, frameMs: number, speed: number): Float64Array {
  const camera = new GameCamera(bounds, { floor })
  const inputAt = cameraInputs(timeline, { floor })
  const steps = new Float64Array((timeline.endStep + 1) * 4)

  const write = (step: number) =>
    steps.set([camera.view.left, camera.view.top, camera.view.width, camera.view.height], step * 4)

  let run = 0

  for (let frame = 1; run <= timeline.endStep; frame++) {
    const now = Math.floor(frame * frameMs + 1)
    const reached = Math.floor((now * speed) / CAMERA.stepMs)

    if (reached <= run) continue

    for (let step = run; step < reached - 1 && step <= timeline.endStep; step++) write(step)

    const last = reached - 1

    if (last <= timeline.endStep) {
      camera.update(last * CAMERA.stepMs, framedItems(inputAt(last), bounds), now)
      write(last)
    }

    run = reached
  }

  return steps
}

describe('cameraTrack at a speed', () => {
  test('updates the camera once per frame, as the game played frame by frame', () => {
    const timeline = zigzagTimeline()

    for (const speed of [0.25, 0.5, 2, 5]) {
      expect(cameraTrack(timeline, bounds, { floor, speed }).steps).toEqual(
        playedFrameByFrame(timeline, CAMERA.stepMs, speed),
      )
    }
  })

  // the site passes both: its screen's frame rate and the speed it plays at
  test('at 60 frames a second, updates the camera once per frame at each speed', () => {
    const timeline = zigzagTimeline()

    for (const speed of [0.25, 0.5, 2, 4, 5]) {
      expect(cameraTrack(timeline, bounds, { floor, fps: 60, speed }).steps).toEqual(
        playedFrameByFrame(timeline, 1000 / 60, speed),
      )
    }
  })

  // at these the division that finds a step's first millisecond lands a millisecond off, to either side
  test('takes a speed and a frame rate that do not divide a step evenly', () => {
    const timeline = zigzagTimeline()

    for (const speed of [0.7, 2.3]) {
      expect(cameraTrack(timeline, bounds, { floor, fps: 144, speed }).steps).toEqual(
        playedFrameByFrame(timeline, 1000 / 144, speed),
      )
    }
  })

  test('at 2x moves the view only after every second step', () => {
    const timeline = zigzagTimeline()
    const { steps } = cameraTrack(timeline, bounds, { floor, speed: 2 })
    let moves = 0

    for (let step = 2; step <= timeline.endStep; step += 2) {
      expect(viewAt(steps, step)).toEqual(viewAt(steps, step - 1))

      if (viewAt(steps, step + 1).join() !== viewAt(steps, step).join()) moves++
    }

    expect(moves).toBeGreaterThan(1000)
  })

  test('at 0.5x updates at every step, and differs from 1x only once the view can hold', () => {
    const timeline = zigzagTimeline()
    const half = cameraTrack(timeline, bounds, { floor, speed: 0.5 }).steps
    const whole = cameraTrack(timeline, bounds, { floor }).steps
    const firstHoldStep = CAMERA.settleMs / CAMERA.stepMs

    expect(half.subarray(0, firstHoldStep * 4)).toEqual(whole.subarray(0, firstHoldStep * 4))
    expect(half).not.toEqual(whole)
  })

  // a player walks out to the right, so the view grows at every update, then jumps back in at jumpStep and stands
  // still: the view holds for half a second of the real clock before it follows
  const jumpStep = 800

  function growThenJumpBack(): Timeline {
    const stayer = { from: 0, x: [] as number[], y: [] as number[] }
    const walker = { from: 0, x: [] as number[], y: [] as number[] }

    for (let step = 0; step <= 1200; step++) {
      stayer.x.push(-600)
      stayer.y.push(600)
      walker.x.push(step < jumpStep ? step * 3 : 1800)
      walker.y.push(600)
    }

    return {
      stepMs: 16,
      startStep: 0,
      endStep: 1200,
      animations: [],
      state: { '1': { animation: [], status: [[0, 'live']] }, '2': { animation: [], status: [[0, 'live']] } },
      positions: { every: 1, '1': stayer, '2': walker },
    }
  }

  // how many steps after the walker's last step out the view first narrows
  function stepsHeld(speed: number): number {
    const { steps } = cameraTrack(growThenJumpBack(), bounds, { speed })
    const width = (step: number) => steps[step * 4 + 2]
    let step = jumpStep

    while (width(step) >= width(jumpStep - 1)) step++

    return step - (jumpStep - 1)
  }

  test('holds the view for half a second of the real clock, whatever the speed', () => {
    // 500 ms is 32 frames of 16 ms: a step each at 1x, half a step at 0.5x, two at 2x
    expect(stepsHeld(1)).toBe(32)
    expect(stepsHeld(0.5)).toBe(16)
    expect(stepsHeld(2)).toBe(64)
  })

  test('refuses a speed of zero or less', () => {
    const timeline = zigzagTimeline()

    for (const speed of [0, -1, -0.25, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => cameraTrack(timeline, bounds, { speed })).toThrow(RangeError)
    }
  })
})
