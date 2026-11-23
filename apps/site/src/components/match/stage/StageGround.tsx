import type { Stage } from '@brawltome/contracts'
import { artBoxOf } from './art-box'
import type { PlacedArt } from './map-art'

// the drawing is this wide and as tall as the stage box makes it; a share of the box times these gives a spot on it
export const stageWidth = 160

function PlatformArt({ piece, height }: { piece: PlacedArt; height: number }) {
  const box = artBoxOf(piece, { width: stageWidth, height })

  return (
    <image
      href={piece.url}
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      preserveAspectRatio="none"
      transform={box.transform}
    />
  )
}

// a mirrored twin shares its file and corner with its piece, and moving platforms that start in one place repeat a
// piece exactly, so a key is all a piece is drawn by and how many like it came before
function artKeysOf(art: PlacedArt[]): string[] {
  const seen = new Map<string, number>()

  return art.map((piece) => {
    const placement = `${piece.file}:${piece.x}:${piece.y}:${piece.width}:${piece.height}:${piece.rotation}`
    const earlier = seen.get(placement) ?? 0

    seen.set(placement, earlier + 1)

    return `${placement}:${earlier}`
  })
}

type StageGroundProps = { stage: Stage; art: PlacedArt[]; height: number }

/** The stage itself: its platforms' art where the art store has it, and its ground and walls as lines over it. */
export function StageGround({ stage, art, height }: StageGroundProps) {
  const artKeys = artKeysOf(art)

  return (
    <>
      {art.map((piece, index) => (
        <PlatformArt key={artKeys[index]} piece={piece} height={height} />
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
