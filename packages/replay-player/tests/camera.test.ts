import { expect, test } from 'bun:test'
import { cameraAt, cameraTrack, type Rect, type Timeline } from '..'

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
