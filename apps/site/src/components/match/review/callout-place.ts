import type { BodyPx } from '../stage/body-ring'
import type { Pose } from '../stage/pose'
import { tagWidthPx } from '../stage/tag-stack'

// where a review's card sits on the stage, measured in pixels of the stage

type Size = { width: number; height: number }
export type Rect = { left: number; top: number; right: number; bottom: number }
export type Point = { x: number; y: number }

// what the card has to share the stage with: the panel of lanes along one edge, and what else lies on the stage,
// like the fullscreen button in its corner
export type CardSpace = {
  card: Size
  stage: Size
  // how big each player is drawn on the stage, by slot: the ring around them and the tag over them
  bodyOf: (slot: number) => BodyPx
  panel: { edge: 'top' | 'bottom'; bandPx: number }
  obstacles: Rect[]
}

// the two players a stop is about
export type StopPlayers = { victim: number | null; attacker: number | null }

export type CardPlace = Point & {
  // true when a card of this shape has no place beside the lanes that is clear of the stop's players
  isOnStopPlayers: boolean
}

// between the card and the stage's edges, as the panel of lanes keeps
const gapPx = 8
// the air the card leaves around the ring of a review's stop
const ringAirPx = 4
// where the card is tried across the stage in each of its rows, as shares of the way from left to right: the corners
// first, then the middle, then between
const acrossShares = [0, 1, 0.5, 0.25, 0.75, 0.125, 0.875, 0.375, 0.625]

// the middle of the ring around a player: the middle of their body, over the feet their pose is at
function ringMiddle(pose: Pose, { stage, bodyOf }: CardSpace): Point {
  return { x: pose.x * stage.width, y: pose.y * stage.height - bodyOf(pose.slot).ringMiddlePx }
}

// what a player takes up around their feet: the ring of a review's stop around the body, and the tag over them
function bodyRect(pose: Pose, space: CardSpace): Rect {
  const body = space.bodyOf(pose.slot)
  const middle = ringMiddle(pose, space)
  const ringReach = body.ringRadiusPx + ringAirPx
  const halfWidth = Math.max(ringReach, tagWidthPx / 2)
  const tagTop = pose.y * space.stage.height - body.tagTopPx

  return {
    left: middle.x - halfWidth,
    top: Math.min(middle.y - ringReach, tagTop),
    right: middle.x + halfWidth,
    bottom: middle.y + ringReach,
  }
}

function sharedArea(left: Rect, right: Rect): number {
  const width = Math.min(left.right, right.right) - Math.max(left.left, right.left)
  const height = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)

  return width > 0 && height > 0 ? width * height : 0
}

function rectAt(place: Point, card: Size): Rect {
  return { left: place.x, top: place.y, right: place.x + card.width, bottom: place.y + card.height }
}

// the top and bottom rows the card can take between the stage's edges and the lanes' band
function rowBounds({ card, stage, panel }: CardSpace): { top: number; bottom: number } {
  const top = gapPx + (panel.edge === 'top' ? panel.bandPx : 0)
  const bottom = stage.height - gapPx - card.height - (panel.edge === 'bottom' ? panel.bandPx : 0)

  return { top, bottom }
}

/**
 * Every place the card can take: along the top, along the bottom and across the middle, inside the stage, off the
 * lanes' band and clear of everything else that lies on the stage. The order is the order of preference: the top
 * first, as it is sky on every stage, and a corner before the places between.
 */
function placesIn(space: CardSpace): Point[] {
  const { card, stage, obstacles } = space
  const { top, bottom } = rowBounds(space)
  const reach = Math.max(stage.width - 2 * gapPx - card.width, 0)
  // a row under whatever lies along the top, for when the top row itself is taken by it
  const alongTop = obstacles.filter((obstacle) => obstacle.top === 0)
  const underObstacles = Math.max(top, ...alongTop.map((obstacle) => obstacle.bottom + gapPx))
  // a card too high for the room between the stage's edge and the band has no row at all
  const rows = [top, underObstacles, bottom, (top + bottom) / 2].filter((y) => y >= top && y <= bottom)
  const places = rows.flatMap((y) => acrossShares.map((share) => ({ x: gapPx + reach * share, y })))
  const isFree = (place: Point) => obstacles.every((obstacle) => sharedArea(rectAt(place, card), obstacle) === 0)

  return places.filter(isFree)
}

// for a stage too small to hold the card beside the lanes: its top left corner, kept inside the stage
function cornerInside({ card, stage }: CardSpace): Point {
  return {
    x: Math.max(Math.min(gapPx, stage.width - card.width), 0),
    y: Math.max(Math.min(gapPx, stage.height - card.height), 0),
  }
}

/**
 * The place for the card: inside the stage and never on the lanes, never on a player of the stop, and on as little of
 * the other players as can be. When the stop's players leave a card of this shape no such place, it says so, and lies
 * where it covers the least of them; the page then tries the low, wide card.
 */
export function placeCard(poses: Pose[], space: CardSpace, stop: StopPlayers): CardPlace {
  const shown = poses.filter((pose) => pose.isInPlay)
  const ofStop = shown.filter((pose) => pose.slot === stop.victim || pose.slot === stop.attacker)

  const coverOf = (place: Point, players: Pose[]) =>
    players.reduce((sum, pose) => sum + sharedArea(rectAt(place, space.card), bodyRect(pose, space)), 0)

  const places = placesIn(space)
  const clear = places.filter((place) => coverOf(place, ofStop) === 0)
  const best = clear.sort((left, right) => coverOf(left, shown) - coverOf(right, shown))[0]

  if (best) return { ...best, isOnStopPlayers: false }

  const leastOnStop = places.sort((left, right) => coverOf(left, ofStop) - coverOf(right, ofStop))[0]

  return { ...(leastOnStop ?? cornerInside(space)), isOnStopPlayers: true }
}

/** The line from the card's corner that faces a player to the edge of the ring around them; none when they touch. */
export function lineToRing(place: Point, space: CardSpace, pose: Pose): { from: Point; to: Point } | null {
  const card = rectAt(place, space.card)
  const ring = ringMiddle(pose, space)
  const radiusPx = space.bodyOf(pose.slot).ringRadiusPx

  const from = {
    x: ring.x > (card.left + card.right) / 2 ? card.right : card.left,
    y: ring.y > (card.top + card.bottom) / 2 ? card.bottom : card.top,
  }

  const length = Math.hypot(from.x - ring.x, from.y - ring.y)

  if (length <= radiusPx) return null

  const reach = radiusPx / length

  return { from, to: { x: ring.x + (from.x - ring.x) * reach, y: ring.y + (from.y - ring.y) * reach } }
}
