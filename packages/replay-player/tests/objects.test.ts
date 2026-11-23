import { expect, test } from 'bun:test'
import { objectsAt, type Timeline } from '..'

type LineObject = NonNullable<Timeline['objects']>[number]

// a line with only objects, drawn from step 10 to 20 with one animation run and one transform key
function lineWith(objects: LineObject[]): Timeline {
  return {
    stepMs: 16,
    startStep: 0,
    endStep: 100,
    animations: [],
    state: {},
    positions: { every: 4 },
    objectAnimations: [['a_Sweat', 'Ready']],
    objects,
  }
}

const sweat: LineObject = {
  from: 10,
  to: 20,
  owner: 2,
  file: 'SFX_1.swf',
  class: 'a_Sweat',
  animation: [[10, 0, 0, 0.384]],
  transform: [[10, 1, 0, 0, 1, 100, 200]],
}

test('objectsAt gives the slot of the player an object follows, from the line', () => {
  const [pose] = objectsAt(lineWith([{ ...sweat, follows: 1 }]), 12)

  expect(pose?.follows).toBe(1)
  expect(pose?.owner).toBe(2)
})

test('objectsAt gives null for an object the line has following no one', () => {
  const [pose] = objectsAt(lineWith([sweat]), 12)

  expect(pose).toBeDefined()
  expect(pose?.follows).toBeNull()
})
