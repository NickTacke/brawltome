import type { Stage } from '@brawltome/contracts'
import type { PlacedArt } from './map-art'

// the drawing is this wide and as tall as the stage box makes it; a share of the box times these gives a spot on it
export const stageWidth = 160

function PlatformArt({ piece, height }: { piece: PlacedArt; height: number }) {
  const x = piece.x * stageWidth
  const y = piece.y * height

  return (
    <image
      href={piece.url}
      x={x}
      y={y}
      width={piece.width * stageWidth}
      height={piece.height * height}
      preserveAspectRatio="none"
      transform={`rotate(${piece.rotation} ${x} ${y})`}
    />
  )
}

type StageGroundProps = { stage: Stage; art: PlacedArt[]; height: number }

/** The stage itself: its platforms' art where the art store has it, and its ground and walls as lines over it. */
export function StageGround({ stage, art, height }: StageGroundProps) {
  return (
    <>
      {art.map((piece) => (
        <PlatformArt key={`${piece.file}:${piece.x}:${piece.y}`} piece={piece} height={height} />
      ))}
      {stage.segments.map((segment) => (
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
      ))}
    </>
  )
}
