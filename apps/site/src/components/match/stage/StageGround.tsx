import type { Stage } from '@brawltome/contracts'

// the drawing is this wide and as tall as the stage box makes it; a share of the box times these gives a spot on it
export const stageWidth = 160

/**
 * The stage's ground and walls as lines, from the map's collision lines. The platform art the layout names is the
 * game's own files, which the art store doesn't carry, so only the lines are drawn.
 */
export function StageGround({ stage, height }: { stage: Stage; height: number }) {
  return stage.segments.map((segment) => (
    <line
      key={`${segment.fromX}:${segment.fromY}:${segment.toX}:${segment.toY}`}
      x1={segment.fromX * stageWidth}
      y1={segment.fromY * height}
      x2={segment.toX * stageWidth}
      y2={segment.toY * height}
      stroke="var(--color-strong)"
      strokeWidth={segment.isSoft ? 0.4 : 0.6}
      strokeLinecap="round"
      opacity={segment.isSoft ? 0.45 : 0.8}
    />
  ))
}
