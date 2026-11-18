// Draws players and objects on a 2D canvas from what src/load.ts loaded, from sprite sheets with drawImage. Browser
// only; no Node APIs.
//
//   const replay = await loadReplay(manifestUrl, { baseUrl, onProgress }) // the first seconds can be drawn
//   // each animation frame:
//   const objects = objectsAt(line.timeline, step, (i) => replay.objects?.animations.frameCount(i) ?? 0)
//   for (const o of objects) if (o.behind) drawObject(ctx, replay, o, levelToCanvas)
//   for (const [slot, player] of replay.players) {
//     const pose = poseAt(line.timeline, slot, step, (i) => player.animations.frameCount(i))
//     if (pose) drawPlayer(ctx, replay, player, pose, levelToCanvas)
//   }
//   for (const o of objects) if (!o.behind) drawObject(ctx, replay, o, levelToCanvas)
//
// A player or object is drawn whole or not at all: drawPlayer and drawObject draw nothing, and return false, while a
// piece of its frame hasn't loaded yet. isReady says whether an animation can be drawn at every frame.
import type { PieceRow, Rect } from './format.ts'
import type { ObjectAssets, PlayerAssets, Replay } from './load.ts'
import { type ArtSet, eachDraw, type Frame, groupOf, type Matrix, multiply, pieceOf } from './placement.ts'
import type { ObjectPose, PlayerPose } from './timeline.ts'
import type { Tint } from './tint.ts'

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

// isReady says whether an animation of a player (or of the objects, in a look) can be drawn at every frame the match
// shows, with every weapon skin
export function isReady(
  replay: Replay,
  drawable: PlayerAssets | ObjectAssets,
  animationIndex: number,
  look = '',
): boolean {
  const key = `${look}|${animationIndex}`

  if (drawable.ready.get(key)) return true

  const set = drawable.sets.get(look) ?? drawable.sets.get('-')
  const entry = drawable.animations.byIndex.get(animationIndex)

  if (!set || !entry) return false

  for (const frameNumber of entry.animation.frames.keys()) {
    const frame = drawable.animations.frame(animationIndex, frameNumber)

    if (!frame || !canDrawEveryWeapon(set, frame, replay.isLoaded)) return false
  }

  drawable.ready.set(key, true)

  return true
}

function canDrawEveryWeapon(set: ArtSet, frame: Frame, isLoaded: (ref: number) => boolean): boolean {
  return set.weapons().every((weapon) => eachDraw(set, weapon, frame, IDENTITY, isLoaded))
}

// zoomOf is how many canvas pixels a level unit covers under a transform
export const zoomOf = (levelToCanvas: Matrix) =>
  Math.sqrt(Math.abs(levelToCanvas[0] * levelToCanvas[3] - levelToCanvas[1] * levelToCanvas[2]))

// wantMissing, as eachDraw's isLoaded, moves each piece that hasn't loaded to the front of what's left to load, and
// lets every draw through so it sees them all
const wantMissing = (replay: Replay) => (ref: number) => {
  if (!replay.isLoaded(ref)) replay.want(ref)

  return true
}

// drawFrame draws a frame whole, or nothing; what it couldn't draw goes to the front of what's left to load
function drawFrame(
  ctx: CanvasRenderingContext2D,
  replay: Replay,
  set: ArtSet,
  weapon: string,
  frame: Frame,
  place: Matrix,
  alpha: number,
): boolean {
  const drawn = eachDraw(set, weapon, frame, place, replay.isLoaded, (ref, a, b, c, d, e, f, opacity) => {
    const group = replay.groups[groupOf(ref)]
    const piece = group?.json.pieces[pieceOf(ref)]
    const sheet = piece && group?.sheets[piece[0]]

    if (!piece || !sheet) return

    const [, sx, sy, sw, sh, x, y, w, h] = piece

    ctx.setTransform(a, b, c, d, e, f)
    ctx.globalAlpha = alpha * opacity
    ctx.drawImage(sheet, sx, sy, sw, sh, x, y, w, h)
  })

  if (!drawn) eachDraw(set, weapon, frame, place, wantMissing(replay))

  return drawn
}

// drawPlayer draws one player's pose. levelToCanvas takes level units to canvas pixels (include devicePixelRatio). It
// draws nothing and returns false while a piece of the frame hasn't loaded. A pose with a tint (from poseAt) is drawn
// in the game's colours: see drawTinted
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  replay: Replay,
  player: PlayerAssets,
  pose: PlayerPose,
  levelToCanvas: Matrix,
): boolean {
  const frame = player.animations.frame(pose.animationIndex, Math.floor(pose.frame))

  if (!frame) return false

  // facing left mirrors the animation around the player's position
  const place = multiply(levelToCanvas, [pose.facingRight ? 1 : -1, 0, 0, 1, pose.x, pose.y])

  ctx.save()

  const drawn = pose.tint
    ? drawTinted(ctx, replay, { set: player.set, weapon: pose.weapon, frame, place }, pose.tint)
    : drawFrame(ctx, replay, player.set, pose.weapon, frame, place, 1)

  ctx.restore()

  return drawn
}

// drawObject draws one object's pose (from objectsAt), like drawPlayer
export function drawObject(
  ctx: CanvasRenderingContext2D,
  replay: Replay,
  pose: ObjectPose,
  levelToCanvas: Matrix,
): boolean {
  const objects = replay.objects
  const set = objects?.sets.get(pose.look)
  const frame = objects?.animations.frame(pose.animationIndex, pose.frame)

  if (!set || !frame) return false

  ctx.save()

  const drawn = drawFrame(ctx, replay, set, '', frame, multiply(levelToCanvas, pose.matrix), pose.alpha)

  ctx.restore()

  return drawn
}

// PlacedFrame is a frame of a set, held with a weapon, and the matrix taking its animation's units to the canvas
type PlacedFrame = { set: ArtSet; weapon: string; frame: Frame; place: Matrix }

type LayerCanvas = { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D }

// Layer is the part of the layer canvas a frame was drawn into
type Layer = LayerCanvas & { width: number; height: number }

// layer is a canvas a tinted player is drawn into first, kept between draws and grown as needed
let layer: LayerCanvas | undefined

function layerOf(width: number, height: number): LayerCanvas {
  if (layer && layer.canvas.width >= width && layer.canvas.height >= height) return layer

  const grownWidth = Math.max(width, layer?.canvas.width ?? 0)
  const grownHeight = Math.max(height, layer?.canvas.height ?? 0)

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(grownWidth, grownHeight)
      : Object.assign(document.createElement('canvas'), { width: grownWidth, height: grownHeight })

  layer = { canvas, ctx: canvas.getContext('2d') as unknown as CanvasRenderingContext2D }

  return layer
}

// Extent is the sides of what's been drawn so far, in canvas pixels
type Extent = { left: number; top: number; right: number; bottom: number }

// extendByPiece grows an extent by the corners of a piece's rectangle, under the matrix taking it to the canvas
function extendByPiece(extent: Extent, piece: PieceRow, toCanvas: Matrix) {
  const [, , , , , x, y, w, h] = piece
  const [a, b, c, d, e, f] = toCanvas

  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]

  for (const [pieceX, pieceY] of corners) {
    const canvasX = a * pieceX + c * pieceY + e
    const canvasY = b * pieceX + d * pieceY + f

    extent.left = Math.min(extent.left, canvasX)
    extent.top = Math.min(extent.top, canvasY)
    extent.right = Math.max(extent.right, canvasX)
    extent.bottom = Math.max(extent.bottom, canvasY)
  }
}

// canvasBoxOf is a frame's box in whole canvas pixels, cut to the canvas, or undefined while a piece hasn't loaded
function canvasBoxOf(ctx: CanvasRenderingContext2D, replay: Replay, placed: PlacedFrame): Rect | undefined {
  const extent: Extent = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  const { set, weapon, frame, place } = placed

  const isLoaded = eachDraw(set, weapon, frame, place, replay.isLoaded, (ref, a, b, c, d, e, f) => {
    const piece = replay.groups[groupOf(ref)]?.json.pieces[pieceOf(ref)]

    if (piece) extendByPiece(extent, piece, [a, b, c, d, e, f])
  })

  if (!isLoaded) return undefined

  const x = Math.max(0, Math.floor(extent.left))
  const y = Math.max(0, Math.floor(extent.top))
  const width = Math.min(ctx.canvas.width, Math.ceil(extent.right)) - x
  const height = Math.min(ctx.canvas.height, Math.ceil(extent.bottom)) - y

  return { x, y, width, height }
}

// drawTinted draws a frame in a tint, as the game's shader does: each channel times the multiplier plus the offset,
// alpha kept (in premultiplied colours, colour times multiplier plus offset times alpha; the game's multipliers are
// all grey, m; another is taken as its channels' mean). The frame goes into a layer the size of its box on the
// canvas, where a fill over what's drawn ("source-atop") at alpha a turns colour P into P (1 - a) + fill a alpha:
// - with m < 1 and the offset at most 255 (1 - m) (the hit flash, out of air jumps), one fill at a = 1 - m of the
//   offset / (1 - m) makes P m + offset alpha, drawn onto the canvas as it is;
// - otherwise the frame is drawn onto the canvas darkened by a black fill at 1 - m (or drawn straight onto it when m
//   is 1), and the offset, cut to the frame's shape ("source-in"), added on top ("lighter"): the game's sum exactly
//   where the canvas under the player is opaque, as a page's background makes it
function drawTinted(ctx: CanvasRenderingContext2D, replay: Replay, placed: PlacedFrame, tint: Tint): boolean {
  const { set, weapon, frame, place } = placed
  const box = canvasBoxOf(ctx, replay, placed)

  if (!box) return drawFrame(ctx, replay, set, weapon, frame, place, 1)

  if (box.width <= 0 || box.height <= 0) return true

  const multiplier = (tint.multiply[0] + tint.multiply[1] + tint.multiply[2]) / 3
  const add = tint.add
  const hasAdd = add[0] + add[1] + add[2] > 0
  const isOneFill = multiplier < 1 && Math.max(...add) <= 255 * (1 - multiplier)

  if (multiplier >= 1) drawFrame(ctx, replay, set, weapon, frame, place, 1)

  if (multiplier >= 1 && !hasAdd) return true

  const tinted = frameInLayer(replay, placed, box)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1

  if (multiplier < 1) {
    const fill = isOneFill ? add.map((channel) => channel / (1 - multiplier)) : [0, 0, 0]

    fillLayer(tinted, 'source-atop', 1 - multiplier, fill)
    copyLayer(ctx, tinted, box, 'source-over')

    if (isOneFill || !hasAdd) return true
  }

  fillLayer(tinted, 'source-in', 1, add)
  copyLayer(ctx, tinted, box, 'lighter')

  return true
}

// frameInLayer draws a frame into the layer, its box's top left at the layer's
function frameInLayer(replay: Replay, placed: PlacedFrame, box: Rect): Layer {
  const tinted = layerOf(box.width, box.height)
  const layerCtx = tinted.ctx

  layerCtx.setTransform(1, 0, 0, 1, 0, 0)
  layerCtx.globalCompositeOperation = 'source-over'
  layerCtx.globalAlpha = 1
  layerCtx.clearRect(0, 0, box.width, box.height)

  const placeInLayer = multiply([1, 0, 0, 1, -box.x, -box.y], placed.place)

  drawFrame(layerCtx, replay, placed.set, placed.weapon, placed.frame, placeInLayer, 1)
  layerCtx.setTransform(1, 0, 0, 1, 0, 0)

  return { ...tinted, width: box.width, height: box.height }
}

function fillLayer(tinted: Layer, operation: GlobalCompositeOperation, alpha: number, colour: number[]) {
  tinted.ctx.globalCompositeOperation = operation
  tinted.ctx.globalAlpha = alpha
  tinted.ctx.fillStyle = `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`
  tinted.ctx.fillRect(0, 0, tinted.width, tinted.height)
}

function copyLayer(ctx: CanvasRenderingContext2D, tinted: Layer, box: Rect, operation: GlobalCompositeOperation) {
  ctx.globalCompositeOperation = operation
  ctx.drawImage(tinted.canvas, 0, 0, box.width, box.height, box.x, box.y, box.width, box.height)
}
