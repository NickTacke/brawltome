// a line that records each player's looks says which one a player is drawn in at each step
import { expect, test } from 'bun:test'
import { poseAt, type Timeline } from '..'

test("poseAt gives the pose's look from the line's state", () => {
  const timeline: Timeline = {
    startStep: 0,
    endStep: 100,
    animations: [],
    state: {
      '1': {
        animation: [[0, 0, 0, 0]],
        look: [
          [0, 0],
          [50, 1],
        ],
      },
    },
    positions: { every: 1, '1': { from: 0, x: [0], y: [0] } },
  }

  expect(poseAt(timeline, '1', 10)?.look).toBe(0)
  expect(poseAt(timeline, '1', 60)?.look).toBe(1)
  expect(poseAt({ ...timeline, state: { '1': { animation: [[0, 0, 0, 0]] } } }, '1', 60)?.look).toBeUndefined()
})
