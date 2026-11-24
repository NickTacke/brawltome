import type { Stage, StageBox } from '@brawltome/contracts'
import { OFFSCREEN } from '@brawltome/replay-player'
import type { CSSProperties } from 'react'
import { portraitTagLiftPx, tagHeightPx, tagLift } from './tag-stack'
import { areLegendsDrawn, type Legends } from './use-legends'

// a ring around a player's body. a drawn legend follows the camera's zoom, so its ring is measured in level units;
// the game gives the body: every legend's standing hurtbox is 145 units wide and 160 high and stands on the feet. a
// move can bring a hurtbox of its own, which the ring doesn't follow. a portrait token, which stands in while there
// is no art or for a player whose own art can't load, is as big on every stage, and so is its ring

// the body's middle is this far above the feet: half the standing hurtbox's height, which the game centres its own
// off-screen bubble on
export const bodyMiddle: number = OFFSCREEN.bodyMiddle

// a ring through the standing hurtbox's corners holds the whole body, so the ring cuts nothing of it: the hurtbox's
// diagonal, the root of 145² + 160², is 216 units
export const bodyRingDiameter = 216

// on a phone's stage the fixed camera draws a legend a dozen pixels high, and a ring that follows it down is lost
// under the numbers of a review's hits, which are 16 pixels across and lie on the feet. the ring is never smaller
// than this, the smallest that shows all round such a number
export const legendRingFloorPx = 32

// the ring around a token: the portrait is 36 pixels and stands on the feet. a phone's small stage gets a smaller
// ring, no wider than this share of the stage
const tokenRing = { middlePx: 14, diameterPx: 64, widestShare: 0.1 }
// how far over the feet a token's tag reaches, with the portrait under it
const tokenTagTopPx = 72

// how the players are drawn on the stage: as their legends, measured in the level units of the stage box, or as tokens.
// among legends, the players whose art can't load are drawn as tokens, by slot
export type DrawnBodies = { box: StageBox; areLegends: boolean; tokenSlots: ReadonlySet<number> }

/** How a match's players are drawn on its stage with what has loaded of its legends. */
export function drawnBodiesOf(stage: Stage, legends: Legends): DrawnBodies {
  return { box: stage.box, areLegends: areLegendsDrawn(legends), tokenSlots: legends.missingSlots }
}

function isLegend(bodies: DrawnBodies, slot: number): boolean {
  return bodies.areLegends && !bodies.tokenSlots.has(slot)
}

type Feet = { x: number; y: number }

// lengths of the level are the same share of the mark layer at every zoom, as the layer covers the stage box
function legendRingStyle(feet: Feet, box: StageBox, share: number): CSSProperties {
  const floorPx = legendRingFloorPx * share
  const widthShare = (bodyRingDiameter * share) / box.width

  return {
    left: `${feet.x * 100}%`,
    top: `${(feet.y - bodyMiddle / box.height) * 100}%`,
    width: `max(${floorPx}px, ${widthShare * 100}%)`,
    aspectRatio: '1',
  }
}

function tokenRingStyle(feet: Feet, share: number): CSSProperties {
  const widthPx = tokenRing.diameterPx * share
  const widestShare = tokenRing.widestShare * share

  return {
    left: `${feet.x * 100}%`,
    top: `calc(${feet.y * 100}% - ${tokenRing.middlePx}px)`,
    width: `min(${widthPx}px, ${widestShare * 100}%)`,
    aspectRatio: '1',
  }
}

/**
 * Where a ring around the body of the player in `slot` goes on the stage's mark layer, from their feet in shares of
 * the stage box, and how big it is: the whole ring, or a share of it. The ring is centred on its place by the
 * element's own translate.
 */
export function bodyRingStyle(feet: Feet, bodies: DrawnBodies, slot: number, share = 1): CSSProperties {
  return isLegend(bodies, slot) ? legendRingStyle(feet, bodies.box, share) : tokenRingStyle(feet, share)
}

// what a player takes up on a stage as it is laid out, in pixels from their feet: the ring around the body, and how
// far up the tag over them reaches
export type BodyPx = { ringMiddlePx: number; ringRadiusPx: number; tagTopPx: number }

// the ring's sizes below are the ones its style above lays out, worked out in pixels

function legendRingDiameterPx(unitPx: number): number {
  return Math.max(bodyRingDiameter * unitPx, legendRingFloorPx)
}

// the mark layer covers the stage box, so it is as wide as the box's level units are on the stage
function tokenRingDiameterPx(box: StageBox, unitPx: number): number {
  const markLayerWidthPx = box.width * unitPx

  return Math.min(tokenRing.diameterPx, markLayerWidthPx * tokenRing.widestShare)
}

// a token among legends has its tag stacked with theirs, over the portrait or as high as theirs, whichever is higher
function tokenTagTopPxOf(bodies: DrawnBodies, unitPx: number): number {
  if (!bodies.areLegends) return tokenTagTopPx

  return Math.max(tagLift * unitPx, portraitTagLiftPx) + tagHeightPx
}

/** The ring and tag of the player in `slot`, in the pixels of a stage on which a level unit is `unitPx` wide. */
export function bodyPxOf(bodies: DrawnBodies, unitPx: number, slot: number): BodyPx {
  if (!isLegend(bodies, slot)) {
    return {
      ringMiddlePx: tokenRing.middlePx,
      ringRadiusPx: tokenRingDiameterPx(bodies.box, unitPx) / 2,
      tagTopPx: tokenTagTopPxOf(bodies, unitPx),
    }
  }

  return {
    ringMiddlePx: bodyMiddle * unitPx,
    ringRadiusPx: legendRingDiameterPx(unitPx) / 2,
    tagTopPx: tagLift * unitPx + tagHeightPx,
  }
}
