import type { CollisionLine, LevelGeometry } from '@brawltome/game-data'
import type { Posture, Vec2 } from './types'

// Distance the entity's feet must be within a hard collision line's surface
// to count as "grounded" on it. Tuned for Brawlhalla's integer coordinate
// space (units ~= pixels at 1x scale).
const GROUND_PROBE_PX = 8

const isHorizontal = (c: CollisionLine): boolean => c.y1 === c.y2
const isVertical = (c: CollisionLine): boolean => c.x1 === c.x2

// Classifies posture purely from geometry: is the feet-point touching a
// horizontal hard/noslide line from above, or is the side of the hitbox
// flush against a vertical hard line? Falls back to 'air' otherwise.
//
// Intentionally static-geometry only. Full movement physics will produce
// posture from the collision resolution step instead; this is the
// starting point that the resolver will call into.
export function classifyPosture(pos: Vec2, level: LevelGeometry): Posture {
  const surfaces = level.collisions.filter((c) => c.kind === 'hard' || c.kind === 'no_slide')

  for (const c of surfaces) {
    if (isHorizontal(c) && c.y1 === c.y2) {
      if (pos.x >= Math.min(c.x1, c.x2) && pos.x <= Math.max(c.x1, c.x2)) {
        const dy = pos.y - c.y1
        if (dy >= -GROUND_PROBE_PX && dy <= GROUND_PROBE_PX) return 'ground'
      }
    }
  }

  for (const c of surfaces) {
    if (isVertical(c)) {
      if (pos.y >= Math.min(c.y1, c.y2) && pos.y <= Math.max(c.y1, c.y2)) {
        const dx = pos.x - c.x1
        if (dx >= -GROUND_PROBE_PX && dx <= GROUND_PROBE_PX) return 'wall'
      }
    }
  }

  return 'air'
}
