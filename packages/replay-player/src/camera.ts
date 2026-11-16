// The game's camera (Camera.hx in its code, the class `_-M2v` in 11.00), worked out from a replay line: the rectangle of
// the level it shows at each step. No Node APIs. The README's "The camera" lists each rule with where it is in the
// game's code; the offsets below are into `_-M2v._-452`, its update, as `bhnative dump --code` prints it.
//
// The update runs once per drawn frame, after that frame's steps, and only when a step ran (`_-D5k._-F4J` calls it
// with the last step's time; it returns at once for a time it has seen, 0x0149). Its rates are per update, not per
// millisecond: tuned once for a 16 ms step (0.384, `_-519._-G4c`, is 24 frames a second over a 16 ms step), never
// scaled by the frame's time. At 60 frames a second and 62.5 steps, one step in 25 shares its frame with the next and
// gets no update of its own; `cameraTrack` updates every step, as the game does on a screen of 63 Hz or more.

import type { Rect } from './format.ts'

export const CAMERA = {
  // where a player is framed from: x, and y this far above their feet (the entity's own camera point, which the game
  // keeps 80 units above its position)
  aimY: -80,
  // room about each player, sideways and up or down (`_-M2v._-E4v`, `_-q1k`, set by `_-K52`)
  roomX: 480,
  roomY: 270,
  // while a player rides the spawn bot back after a KO and stands on it (its state 2 and 3), the bottom has this much
  // more room, but stops at the bottom of the level's collision (0x06b3-0x0757; `_-M2v._-Y1x`)
  spawnBotRoom: 350,
  // weapons and crates: room about them (`_-U5l`, `_-X2N`), how far past the view a soft one may pull it each update
  // (`_-s5f`, 25 x 0.384), and how long a dropped item stays framed after it's made (0x0f9e)
  itemRoomX: 320,
  itemRoomY: 180,
  itemReach: 25 * 0.384,
  itemMs: 5000,
  // the window pans this much of the way to the players' middle each update (0x09a1)
  panRate: 0.025,
  // the view's least size (0x0cef), or the screen's in pixels where that's bigger; never more than the bounds
  minWidth: 2100,
  minHeight: 1400,
  // what's kept of a side's way in each update, and the least it moves (0x207b-0x23f8; `_-Z1G` = 1 - 0.384 / 18)
  keep: 1 - 0.384 / 18,
  deadZone: 2.5,
  // how much faster a side may move out each update than the update before, sideways and up or down (`_-ML`, `_-9W`)
  speedUpX: 10.4,
  speedUpY: 5.85,
  // a side moving out by more than this is growing (0x2186)
  growing: -2,
  // the view stays on the window for the match's first 3 seconds, and once 6 seconds are past, holds for half a second
  // after it last grew (0x2489-0x2557)
  stillMs: 3000,
  settleMs: 6000,
  holdMs: 500,
  stepMs: 16,
  // a player knocked out of their last stock is framed this many steps more, until the stock mode hides them
  // (`_-S6O._-f58` sets Entity's flag `_-33N`, which the update skips at 0x07f2)
  eliminatedSteps: 95,
  // a 1080p screen, headless and the commonest
  screen: { width: 1920, height: 1080 },
}

// the parts of a line's timeline the camera reads
export type CameraTimeline = {
  endStep: number
  state: Record<string, { status?: [number, string][] }>
  positions: { every: number } & Record<string, { from: number; x: number[]; y: number[] } | number>
  objects?: {
    from: number
    to: number
    class: string
    owner: number | null
    transform: [number, number, number, number, number, number, number][]
    alpha?: [number, number][]
  }[]
}

// what the camera frames at one update: each player's position (their feet) and whether they're on the spawn bot,
// and the items that pull at it
export type CameraInput = {
  players: { x: number; y: number; onSpawnBot: boolean }[]
  // hard: the view takes its room whole, but none below it (a thrown weapon in flight, in a match of two players);
  // soft: the view grows towards its room by no more than itemReach an update
  items: { x: number; y: number; hard: boolean }[]
}

export type CameraOptions = {
  // the bounding box of the level's collision lines (src/level.ts collisionBounds): the spawn bot's room stops at its
  // bottom, and items are framed inside it
  floor?: Rect
  // the screen in pixels: its shape is the view's, and its size the view's least where it's above 2100 by 1400
  screen?: { width: number; height: number }
  // each weapon and crate art class's height (src/data.ts itemHeights): the game frames an item from half its height
  // above where its art is drawn
  itemHeights?: Record<string, number>
  // the screen's frame rate, for a camera updated once per drawn frame as the game's is: a frame that runs two steps
  // updates once, after the second, and the half second's hold is timed by the frame's clock. Left out, it updates
  // every step, as on a screen of 63 Hz or more
  fps?: number
}

// Box is a rectangle kept as its sides, as the game's flash.geom.Rectangle sets them
class Box {
  left: number
  top: number
  right: number
  bottom: number
  constructor(r: Rect) {
    this.left = r.x
    this.top = r.y
    this.right = r.x + r.width
    this.bottom = r.y + r.height
  }
  get width() {
    return this.right - this.left
  }
  get height() {
    return this.bottom - this.top
  }
  copy(from: Box) {
    this.left = from.left
    this.top = from.top
    this.right = from.right
    this.bottom = from.bottom
  }
  rect(): Rect {
    return { x: this.left, y: this.top, width: this.width, height: this.height }
  }
}

// growX sets a box's width about its middle, kept inside the window (`_-a1z`); growY its height (`_-R2P`)
function growX(box: Box, width: number, window: Box) {
  box.left = Math.max(window.left, box.left - (width - box.width) / 2)
  if (box.left + width > window.right) box.left = window.right - width

  box.right = box.left + width
}

function growY(box: Box, height: number, window: Box) {
  box.top = Math.max(window.top, box.top - (height - box.height) / 2)
  if (box.top + height > window.bottom) box.top = window.bottom - height

  box.bottom = box.top + height
}

// fit gives a box the screen's shape, growing the side that's short, inside the window (`_-63S`)
function fit(box: Box, aspect: number, window: Box) {
  if (box.width / box.height > aspect) {
    const height = box.width / aspect

    if (height <= window.height) growY(box, height, window)
    else {
      box.top = window.top
      box.bottom = window.bottom
      growX(box, box.height * aspect, window)
    }
  } else if (box.width / box.height < aspect) {
    const width = box.height * aspect

    if (width < window.width) growX(box, width, window)
    else {
      box.left = window.left
      box.right = window.right
      growY(box, box.width / aspect, window)
    }
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

type Sides = { left: number; right: number; top: number; bottom: number }

// fastestOut is how far a side moving out may go this update: no faster than speedUp more than it went the last
const fastestOut = (way: number, lastWay: number, speedUp: number) =>
  Math.max(way, Math.min(lastWay, speedUp) - speedUp)

// easeIn is how far a side moving in goes this update: it keeps `keep` of its way to go, moves at least the dead zone,
// and stops within it
function easeIn(way: number, deadZone: number): number {
  if (way <= deadZone) return 0

  const move = way * CAMERA.keep

  return way - move < deadZone ? way - deadZone : move
}

// GameCamera is the game's camera, updated once per step with what it frames
export class GameCamera {
  readonly view: Box
  private readonly bounds: Box
  private readonly window: Box
  private readonly target: Box
  private readonly floor?: Box
  private readonly aspect: number
  private readonly minWidth: number
  private readonly minHeight: number
  private readonly last: Sides = { left: 0, right: 0, top: 0, bottom: 0 }
  private grewAt = 0
  private started = false

  constructor(bounds: Rect, options: CameraOptions = {}) {
    const screen = options.screen ?? CAMERA.screen

    this.aspect = screen.width / screen.height
    this.bounds = new Box(bounds)
    this.floor = options.floor && new Box(options.floor)
    this.window = windowOf(bounds, this.aspect)
    this.view = new Box(this.window.rect())
    this.target = new Box(bounds)
    this.minWidth = Math.min(Math.max(CAMERA.minWidth, screen.width), bounds.width)
    this.minHeight = Math.min(Math.max(CAMERA.minHeight, screen.height), bounds.height)
  }

  // update moves the camera on after a frame's steps: ms is the time of its last step since the match's first (16 x the
  // step), now the frame's clock in milliseconds, which times the hold (the game's own, `_-D5k._-w3Q`)
  update(ms: number, input: CameraInput, now = ms) {
    // the first update shows the window (`_-K52`, then 0x1b26)
    if (!this.started) {
      this.started = true
      this.grewAt = now

      return
    }

    this.framePlayers(input.players)
    this.panWindow()
    this.keepTargetInWindow()

    for (const item of input.items) this.frameItem(item)

    if (input.items.length > 0) this.keepTargetInWindow()

    const isGrowing = this.easeSides(ms, now)

    // at least the least size, grown about its middle, then the screen's shape (0x241c)
    if (this.target.width < this.minWidth) growX(this.target, this.minWidth, this.window)

    if (this.target.height < this.minHeight) growY(this.target, this.minHeight, this.window)

    fit(this.target, this.aspect, this.window)

    // the view takes the target, unless it's holding (0x250f)
    const isHeld = !isGrowing && ms > CAMERA.settleMs && this.grewAt + CAMERA.holdMs > now

    if (ms >= CAMERA.stillMs && !isHeld) this.view.copy(this.target)
  }

  // framePlayers sets the target to the players, each with their room (0x065c-0x0999), or to the view with none
  private framePlayers(players: CameraInput['players']) {
    const target = this.target

    target.left = Infinity
    target.top = Infinity
    target.right = -Infinity
    target.bottom = -Infinity

    for (const player of players) {
      const y = player.y + CAMERA.aimY

      target.left = Math.min(target.left, player.x - CAMERA.roomX)
      target.right = Math.max(target.right, player.x + CAMERA.roomX)
      target.top = Math.min(target.top, y - CAMERA.roomY)
      target.bottom = Math.max(target.bottom, y + CAMERA.roomY + this.roomBelow(player))
    }

    if (players.length === 0) target.copy(this.view)
  }

  // roomBelow is the room a player riding the spawn bot gets below them, which stops at the bottom of the level's
  // collision (0x06b3-0x0757)
  private roomBelow(player: CameraInput['players'][number]): number {
    if (!player.onSpawnBot || !this.floor) return 0

    const floor = this.floor.bottom

    if (player.y > floor) return -CAMERA.roomY

    if (player.y < floor - CAMERA.spawnBotRoom - CAMERA.roomY) return CAMERA.spawnBotRoom

    return floor - player.y - CAMERA.roomY
  }

  // panWindow pans the window towards the players' middle across, or up and down where it's as wide as the bounds
  // (0x09a1)
  private panWindow() {
    const { window, bounds, target } = this

    if (window.width < bounds.width) {
      const pan = (target.left + target.width / 2 - (window.left + window.width / 2)) * CAMERA.panRate
      const left = clamp(window.left + pan, bounds.left, bounds.right - window.width)

      window.right += left - window.left
      window.left = left

      return
    }

    if (window.height < bounds.height) {
      const pan = (target.top + target.height / 2 - (window.top + window.height / 2)) * CAMERA.panRate
      const top = clamp(window.top + pan, bounds.top, bounds.bottom - window.height)

      window.bottom += top - window.top
      window.top = top
    }
  }

  private keepTargetInWindow() {
    const { window, target } = this

    target.left = Math.max(target.left, window.left)
    target.right = Math.min(target.right, window.right)
    target.top = Math.max(target.top, window.top)
    target.bottom = Math.min(target.bottom, window.bottom)
  }

  // frameItem adds an item's room to the target, its place kept inside the level's collision box (0x0fd4-0x1200)
  private frameItem(item: CameraInput['items'][number]) {
    const { target, view, floor } = this
    const left = (floor ? Math.max(item.x, floor.left) : item.x) - CAMERA.itemRoomX
    const right = (floor ? Math.min(item.x, floor.right) : item.x) + CAMERA.itemRoomX
    const top = item.y - CAMERA.itemRoomY
    const bottom = (floor ? Math.min(item.y, floor.bottom) : item.y) + CAMERA.itemRoomY

    if (item.hard) {
      target.left = Math.min(target.left, left)
      target.right = Math.max(target.right, right)
      target.top = Math.min(target.top, top)

      return
    }

    target.left = Math.min(target.left, Math.max(left, view.left - CAMERA.itemReach))
    target.right = Math.max(target.right, Math.min(right, view.right + CAMERA.itemReach))
    target.top = Math.min(target.top, Math.max(top, view.top - CAMERA.itemReach))
    target.bottom = Math.max(target.bottom, Math.min(bottom, view.bottom + CAMERA.itemReach))
  }

  // easeSides moves each side of the target from the view towards where it is now (0x207b), and says whether the view
  // is growing
  private easeSides(ms: number, now: number): boolean {
    const { target, view } = this

    const ways: Sides = {
      left: target.left - view.left,
      right: view.right - target.right,
      top: target.top - view.top,
      bottom: view.bottom - target.bottom,
    }

    const isGrowing = Object.values(ways).some((way) => way < CAMERA.growing)

    if (isGrowing || ms <= CAMERA.settleMs) this.grewAt = now

    this.limitSpeedUp(ways)

    const deadZoneY = CAMERA.deadZone / this.aspect

    target.left -= easeIn(ways.left, CAMERA.deadZone)
    target.right += easeIn(ways.right, CAMERA.deadZone)
    target.top -= easeIn(ways.top, deadZoneY)
    target.bottom += easeIn(ways.bottom, deadZoneY)
    Object.assign(this.last, ways)

    return isGrowing
  }

  // limitSpeedUp holds a side moving out to no faster than speedUp more than it went the update before (0x21a2)
  private limitSpeedUp(ways: Sides) {
    const { target, view, last } = this

    if (ways.left < 0 && last.left - CAMERA.speedUpX > ways.left) {
      ways.left = fastestOut(ways.left, last.left, CAMERA.speedUpX)
      target.left = view.left + ways.left
    }

    if (ways.right < 0 && last.right - CAMERA.speedUpX > ways.right) {
      ways.right = fastestOut(ways.right, last.right, CAMERA.speedUpX)
      target.right = view.right - ways.right
    }

    if (ways.top < 0 && last.top - CAMERA.speedUpY > ways.top) {
      ways.top = fastestOut(ways.top, last.top, CAMERA.speedUpY)
      target.top = view.top + ways.top
    }

    if (ways.bottom < 0 && last.bottom - CAMERA.speedUpY > ways.bottom) {
      ways.bottom = fastestOut(ways.bottom, last.bottom, CAMERA.speedUpY)
      target.bottom = view.bottom - ways.bottom
    }
  }
}

// windowOf is the camera's first window: the bounds cut to the screen's shape (0x1c59), in their middle across, and at
// their top when they're taller than the screen (the first update's, 0x1d9f)
function windowOf(bounds: Rect, aspect: number): Box {
  const window = new Box(bounds)

  if (bounds.width / bounds.height > aspect) {
    const width = bounds.height * aspect

    window.left = bounds.x + (bounds.width - width) / 2
    window.right = window.left + width
  } else if (bounds.width / bounds.height < aspect) {
    window.bottom = bounds.y + bounds.width / aspect
  }

  return window
}

// cameraOptions are the options an export's manifest.json carries (src/format.ts): the level's collision box and the
// heights of the items the line draws
export const cameraOptions = (manifest: {
  cameraFloor?: Rect
  itemHeights?: Record<string, number>
}): CameraOptions => ({
  ...(manifest.cameraFloor ? { floor: manifest.cameraFloor } : {}),
  ...(manifest.itemHeights ? { itemHeights: manifest.itemHeights } : {}),
})

// CameraTrack is the camera's rectangle at every step of a match
export type CameraTrack = { steps: Float64Array; at(step: number): Rect | undefined }

type Key = [number, number, number, number, number, number, number]

type Samples = { from: number; x: number[]; y: number[] }

type CameraObject = NonNullable<CameraTimeline['objects']>[number]

// Item is a weapon or crate that pulls at the camera from one step until another
type Item = { from: number; to: number; hard: boolean; keys: Key[]; drop: number }

// keyAt is an object's place at a step, between its transform keys
function keyAt(keys: Key[], step: number): { x: number; y: number } {
  let i = 0

  while (i + 1 < keys.length && keys[i + 1][0] <= step) i++

  const a = keys[i]
  const b = keys[i + 1]

  if (!b || step <= a[0]) return { x: a[5], y: a[6] }

  const t = (step - a[0]) / (b[0] - a[0])

  return { x: a[5] + (b[5] - a[5]) * t, y: a[6] + (b[6] - a[6]) * t }
}

// the steps a crate is made before its art is drawn, and how long it waits unseen before it falls (its state 4)
const crateLead = 38
const crateWait = 73
// a thrown weapon is in flight (its state 1) until its art's speed changes by more than this in a step, past the
// throw's own first steps: it hit the ground, a wall or a player; it stops a step sooner when it stops dead
const flightTurn = 10
const throwSteps = 2
// a thrown weapon that fades out once it has lain still is framed, softly, in its last 10 steps (its state 3)
const fadeSteps = 10
const defaultItemHeight = 120

function samplesOf(timeline: CameraTimeline, slot: string): Samples | undefined {
  const samples = timeline.positions[slot]

  return !samples || typeof samples === 'number' || samples.x.length === 0 ? undefined : samples
}

// feetAt is a player's feet at a step, between the samples, or undefined before the first
function feetAt(samples: Samples, every: number, step: number): { x: number; y: number } | undefined {
  const at = (step - samples.from) / every

  if (at < 0) return undefined

  const i = Math.min(samples.x.length - 1, Math.floor(at))
  const j = Math.min(samples.x.length - 1, i + 1)
  const t = Math.min(1, at - i)

  return { x: samples.x[i] + (samples.x[j] - samples.x[i]) * t, y: samples.y[i] + (samples.y[j] - samples.y[i]) * t }
}

// hiddenFromOf is when each player stops being framed: 95 steps after they're eliminated
function hiddenFromOf(timeline: CameraTimeline): Map<string, number> {
  const hiddenFrom = new Map<string, number>()

  for (const [slot, state] of Object.entries(timeline.state)) {
    const eliminated = (state.status ?? []).find(([, name]) => name === 'eliminated')

    if (eliminated) hiddenFrom.set(slot, eliminated[0] + CAMERA.eliminatedSteps)
  }

  return hiddenFrom
}

// botStartAfterKo is the step a knocked out player starts back to the respawn point on the spawn bot: from the first
// sample that moves away from where the KO left them
function botStartAfterKo(samples: Samples, every: number, koStep: number, until: number): number {
  const first = Math.max(0, Math.ceil((koStep - samples.from) / every))

  for (let k = first + 1; k < samples.x.length && samples.from + k * every < until; k++) {
    const hasMoved = Math.abs(samples.x[k] - samples.x[first]) > 0.5 || Math.abs(samples.y[k] - samples.y[first]) > 0.5

    if (hasMoved) return samples.from + (k - 1) * every + 1
  }

  return until
}

// spawnBotSpansOf is when a player is on the spawn bot (its states 2 and 3): from where a KO'd player starts back to
// the respawn point, through respawning; before that they wait where they were knocked out (state 1)
function spawnBotSpansOf(timeline: CameraTimeline, slot: string): [number, number][] {
  const status = timeline.state[slot].status ?? []
  const samples = samplesOf(timeline, slot)
  const every = timeline.positions.every
  const spans: [number, number][] = []

  for (let i = 0; i < status.length; i++) {
    const [from, name] = status[i]
    const to = status[i + 1]?.[0] ?? timeline.endStep + 1

    if (name === 'respawning') spans.push([from, to])

    if (name === 'ko' && samples) spans.push([botStartAfterKo(samples, every, from, to), to])
  }

  return spans
}

// flightEndOf is the step a thrown weapon stops flying: its art turns sharply, or stops dead a step sooner
function flightEndOf(object: CameraObject): number {
  const at = (step: number) => keyAt(object.transform, step)

  for (let step = object.from + throwSteps + 1; step < object.to; step++) {
    const [a, b, c] = [at(step - 2), at(step - 1), at(step)]
    const turn = Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y)

    if (turn > flightTurn) return Math.hypot(c.x - b.x, c.y - b.y) < 0.5 ? step - 1 : step
  }

  return object.to
}

// itemsOfObject is what an object pulls at the camera with: in a match of two players, a thrown weapon in flight, and
// a crate from when it falls until 5 seconds after it was made; in any match, a thrown weapon in its last steps as it
// fades
function itemsOfObject(object: CameraObject, isTwoPlayers: boolean, options: CameraOptions): Item[] {
  if (!object.class.startsWith('a__AnimationWeapon') || object.transform.length === 0) return []

  const drop = (options.itemHeights?.[object.class] ?? defaultItemHeight) / 2
  const keys = object.transform

  if (object.class === 'a__AnimationWeaponCrate') {
    if (!isTwoPlayers) return []

    const made = object.from - crateLead
    const to = Math.min(object.to, made + Math.ceil(CAMERA.itemMs / CAMERA.stepMs))

    return [{ from: made + crateWait, to, hard: false, keys, drop }]
  }

  if (object.owner === null) return []

  const items: Item[] = []

  if (isTwoPlayers) items.push({ from: object.from, to: flightEndOf(object), hard: true, keys, drop })

  if (object.alpha?.length) items.push({ from: object.to - fadeSteps, to: object.to, hard: false, keys, drop })

  return items
}

// cameraInputs works out, from a line, what the camera frames at each step: each player's position and spawn-bot
// state, and the weapons and crates that pull at it
export function cameraInputs(timeline: CameraTimeline, options: CameraOptions = {}): (step: number) => CameraInput {
  const slots = Object.keys(timeline.state)
  const every = timeline.positions.every
  const hiddenFrom = hiddenFromOf(timeline)
  const spawnBotSpans = new Map(slots.map((slot) => [slot, spawnBotSpansOf(timeline, slot)]))
  const isTwoPlayers = slots.length === 2
  const items = (timeline.objects ?? []).flatMap((object) => itemsOfObject(object, isTwoPlayers, options))

  const playerAt = (slot: string, step: number) => {
    const samples = samplesOf(timeline, slot)
    const feet = samples && feetAt(samples, every, step)

    if (!feet || step >= (hiddenFrom.get(slot) ?? Infinity)) return []

    const onSpawnBot = (spawnBotSpans.get(slot) ?? []).some(([from, to]) => step >= from && step < to)

    return [{ x: feet.x, y: feet.y, onSpawnBot }]
  }

  const itemAt = (item: Item, step: number) => {
    if (step < item.from || step >= item.to) return []

    const at = keyAt(item.keys, step)

    return [{ x: at.x, y: at.y - item.drop, hard: item.hard }]
  }

  return (step: number) => ({
    players: slots.flatMap((slot) => playerAt(slot, step)),
    items: items.flatMap((item) => itemAt(item, step)),
  })
}

// framedItems keeps the items the game frames: a thrown weapon only inside the bounds' sides and above their bottom
// (0x0f2b)
export function framedItems(input: CameraInput, bounds: Rect): CameraInput {
  const items = input.items.filter(
    (item) =>
      !item.hard || (item.x >= bounds.x && item.x <= bounds.x + bounds.width && item.y < bounds.y + bounds.height),
  )

  return { players: input.players, items }
}

// frameOf is the frame a step is drawn in: its clock, in whole milliseconds as the game's, and whether the step is the
// frame's last. Without a frame rate every step is a frame's last
function frameOf(step: number, fps: number | undefined): { now: number; isLast: boolean } {
  if (!fps) return { now: step * CAMERA.stepMs, isLast: true }

  const frameMs = 1000 / fps
  const frame = Math.ceil(((step + 1) * CAMERA.stepMs - 1) / frameMs)
  const now = Math.floor(frame * frameMs + 1)

  return { now, isLast: Math.floor(now / CAMERA.stepMs) - 1 === step }
}

// rectAt is a track's rectangle at a step, between the two steps around it
function rectAt(steps: Float64Array, step: number): Rect | undefined {
  if (steps.length === 0) return undefined

  const lastStep = steps.length / 4 - 1
  const at = Math.max(0, Math.min(lastStep, step))
  const i = Math.floor(at)
  const j = Math.min(lastStep, i + 1)
  const t = at - i
  const value = (k: number) => steps[i * 4 + k] + (steps[j * 4 + k] - steps[i * 4 + k]) * t

  return { x: value(0), y: value(1), width: value(2), height: value(3) }
}

// cameraTrack plays the camera over a line's steps. bounds is the level's CameraBounds (LevelDesc, Dynamic.swz); see
// CameraOptions for the rest
export function cameraTrack(timeline: CameraTimeline, bounds: Rect, options: CameraOptions = {}): CameraTrack {
  const camera = new GameCamera(bounds, options)
  const inputAt = cameraInputs(timeline, options)
  const steps = new Float64Array((timeline.endStep + 1) * 4)

  for (let step = 0; step <= timeline.endStep; step++) {
    const { now, isLast } = frameOf(step, options.fps)

    if (isLast) camera.update(step * CAMERA.stepMs, framedItems(inputAt(step), bounds), now)

    const view = camera.view

    steps.set([view.left, view.top, view.width, view.height], step * 4)
  }

  return { steps, at: (step) => rectAt(steps, step) }
}

// cameraAt is the camera's rectangle at a step (steps may be fractional), or undefined for an empty track
export const cameraAt = (track: CameraTrack, step: number) => track.at(step)

// viewToCanvas is the matrix taking level units to a canvas width by height pixels that shows the rectangle, centred
// and fitted, the way the game scales its world to the screen
export function viewToCanvas(
  rect: Rect,
  width: number,
  height: number,
): [number, number, number, number, number, number] {
  const scale = Math.min(width / rect.width, height / rect.height)
  const x = (width - rect.width * scale) / 2 - rect.x * scale
  const y = (height - rect.height * scale) / 2 - rect.y * scale

  return [scale, 0, 0, scale, x, y]
}

// backgroundToCanvas is the matrix taking a level's background image (its LevelDesc's Background, at its own width by
// height) to a canvas width by height pixels, as the game draws it: in a layer under the level that the camera never
// moves, scaled once to cover the screen with two pixels to spare on each side, from its top left (`_-M2v._-452`
// 0x1b26-0x1c59). A LevelDesc's AnimatedBackground without Midground="true" is drawn in the same layer, in the image's
// units; with it, it moves with the level
export function backgroundToCanvas(
  image: { width: number; height: number },
  width: number,
  height: number,
): [number, number, number, number, number, number] {
  const scale = image.width / image.height >= width / height ? (height + 4) / image.height : (width + 4) / image.width

  return [scale, 0, 0, scale, -1, -1]
}
