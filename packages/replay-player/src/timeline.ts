// Reads a player's pose at a step from a bh-native replay line's timeline: what src/draw.ts needs to draw them.
// No Node APIs.

import { lastAt, valueAt } from './steps.ts'
import { type Tint, tintAt } from './tint.ts'

// the parts of a line's timeline this reads
export type Timeline = {
  stepMs?: number
  startStep: number
  endStep: number
  animations: [string, string][]
  state: Record<
    string,
    {
      animation: [number, number | null, number, number][]
      facingRight?: [number, boolean][]
      weapon?: [number, string][]
      status?: [number, string][]
      // what the game's drawing tints a player by (src/tint.ts), in lines that record it
      damage?: [number, number][]
      airJumpsUsed?: [number, number][]
      invulnerable?: [number, boolean][]
      afterRespawn?: [number, boolean][]
      lastHit?: [number, number][]
    }
  >
  // the game's clock at step 0, in ms, in lines that record the tint's state
  stepZeroTime?: number
  positions: { every: number } & Record<string, { from: number; x: number[]; y: number[] } | number>
  // the objects, in lines from bh-native that record them
  objectAnimations?: [string, string][]
  objectLooks?: {
    customArt: ([string, string, number] | [string, string, number, boolean])[]
    colorSwaps: [number, number, number][]
  }[]
  objects?: LineObject[]
}

// LineObject is one object the game drew besides the players, as the line has it
export type LineObject = {
  from: number
  to: number // the first step it isn't drawn
  owner: number | null
  file: string
  class: string
  look?: number
  behind?: boolean
  animation: [number, number | null, number, number][]
  transform: [number, number, number, number, number, number, number][]
  alpha?: [number, number][]
}

export type ObjectPose = {
  index: number // into the line's timeline.objects
  animationIndex: number // into the line's timeline.objectAnimations
  look: string // "-", or the index into timeline.objectLooks: the key ObjectsFile.animations[i].looks uses
  frame: number
  matrix: [number, number, number, number, number, number] // the object's units to level units
  alpha: number
  behind: boolean // drawn under the players
  owner: number | null
}

export type PlayerPose = {
  animationIndex: number // into the line's timeline.animations
  frame: number // 0-based frame of that animation
  facingRight: boolean
  x: number // the player's feet, in level units
  y: number
  weapon: string // the weapon held ("Scythe", "Unarmed", an item's name)
  tint?: Tint // the colour the game draws the player with on top of their art (src/tint.ts), when there's one
}

// positionAt is where a player's feet are at a step, between the samples taken every few steps. Steps may be
// fractional, for drawing between steps.
export function positionAt(
  timeline: Timeline,
  slot: string | number,
  step: number,
): { x: number; y: number } | undefined {
  const samples = timeline.positions[String(slot)]

  if (!samples || typeof samples === 'number' || samples.x.length === 0) return undefined

  const at = Math.max(0, Math.min(samples.x.length - 1, (step - samples.from) / timeline.positions.every))
  const i = Math.floor(at)
  const j = Math.min(samples.x.length - 1, i + 1)
  const t = at - i

  return { x: samples.x[i] + (samples.x[j] - samples.x[i]) * t, y: samples.y[i] + (samples.y[j] - samples.y[i]) * t }
}

// poseAt is a player's pose at a step, or undefined when they show no animation (not spawned, knocked out). The frame
// shown is the run's start frame plus framesPerStep for each step since, as the game counts it; frameCount, when
// given, keeps it on the animation's last frame.
export function poseAt(
  timeline: Timeline,
  slot: string | number,
  step: number,
  frameCount?: (animationIndex: number) => number,
): PlayerPose | undefined {
  const state = timeline.state[String(slot)]

  if (!state) return undefined

  const whole = Math.floor(step)
  const run = state.animation[lastAt(state.animation, whole)]

  if (!run || run[1] === null) return undefined

  const [start, animationIndex, first, perStep] = run
  let frame = Math.floor(first + perStep * (whole - start))
  const count = frameCount?.(animationIndex)

  if (count !== undefined && frame >= count) frame = count - 1

  const position = positionAt(timeline, slot, step)

  if (!position) return undefined

  return {
    animationIndex,
    frame: Math.max(0, frame),
    facingRight: valueAt(state.facingRight, whole) ?? true,
    x: position.x,
    y: position.y,
    weapon: valueAt(state.weapon, whole) ?? 'Unarmed',
    tint: tintAt(timeline, slot, whole),
  }
}

// keyAt interpolates [step, ...values] keys in a straight line between the two around a step (steps may be
// fractional); before the first and after the last it holds
function keyAt(keys: readonly (readonly number[])[], step: number, into: number[]): boolean {
  if (keys.length === 0) return false

  const i = lastAt(keys as unknown as [number][], step)
  const a = keys[Math.max(0, i)]
  const b = keys[Math.min(keys.length - 1, i + 1)]
  const t = i < 0 || b[0] === a[0] ? 0 : Math.min(1, (step - a[0]) / (b[0] - a[0]))

  for (let v = 1; v < a.length; v++) into[v - 1] = a[v] + (b[v] - a[v]) * t

  return true
}

// objectPoseAt is an object's pose at a step, or undefined while it shows no animation. matrix is filled with its
// transform, kept between objects so a step allocates no more than its poses
function objectPoseAt(
  object: LineObject,
  index: number,
  step: number,
  matrix: number[],
  frameCount?: (animationIndex: number, look: string) => number,
): ObjectPose | undefined {
  const whole = Math.floor(step)
  const run = object.animation[lastAt(object.animation, whole)]

  if (!run || run[1] === null) return undefined

  const [start, animationIndex, first, perStep] = run
  const look = object.look === undefined ? '-' : String(object.look)
  let frame = Math.max(0, Math.floor(first + perStep * (whole - start) + 1e-9))
  const count = frameCount?.(animationIndex, look)

  if (count !== undefined && count > 0 && frame >= count) frame = count - 1

  if (!keyAt(object.transform, step, matrix)) return undefined

  return {
    index,
    animationIndex,
    look,
    frame,
    matrix: [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]],
    alpha: valueAt(object.alpha, whole) ?? 1,
    behind: object.behind ?? false,
    owner: object.owner,
  }
}

// objectsAt lists the objects drawn at a step, in the order the line has them (the order they appeared). frameCount,
// when given, keeps a frame on its animation's last.
export function objectsAt(
  timeline: Timeline,
  step: number,
  frameCount?: (animationIndex: number, look: string) => number,
): ObjectPose[] {
  const poses: ObjectPose[] = []
  const whole = Math.floor(step)
  const objects = timeline.objects ?? []
  const matrix = [0, 0, 0, 0, 0, 0]

  for (let index = 0; index < objects.length; index++) {
    const object = objects[index]

    // objects are in the order they appeared, so none after this one has either
    if (object.from > whole) break

    const pose = whole < object.to ? objectPoseAt(object, index, step, matrix, frameCount) : undefined

    if (pose) poses.push(pose)
  }

  return poses
}
