import type { StageArt } from '@brawltome/contracts'

// where a platform's image goes on the stage's drawing. a piece is its image drawn from its corner over its width and
// height, then turned about that corner. a negative width or height mirrors the image: it is flipped, and reaches
// left of the corner or above it before the turn

type Drawing = { width: number; height: number }

/** An image's box on the drawing, from the piece's corner, and the transform that flips and turns it there. */
export type ArtBox = { x: number; y: number; width: number; height: number; transform: string }

function isMirrored(piece: StageArt): boolean {
  return piece.width < 0 || piece.height < 0
}

// an svg image takes a negative width or height as unset and sizes that side from the image itself, so a mirrored
// piece gets its size without the sign and is flipped over its corner
function flipAbout(x: number, y: number, piece: StageArt): string {
  const scaleX = piece.width < 0 ? -1 : 1
  const scaleY = piece.height < 0 ? -1 : 1

  return `translate(${x} ${y}) scale(${scaleX} ${scaleY}) translate(${-x} ${-y})`
}

/** Where a piece's image is drawn. The flip comes before the turn, as the game scales a piece and then turns it. */
export function artBoxOf(piece: StageArt, drawing: Drawing): ArtBox {
  const x = piece.x * drawing.width
  const y = piece.y * drawing.height
  const turn = `rotate(${piece.rotation} ${x} ${y})`

  return {
    x,
    y,
    width: Math.abs(piece.width) * drawing.width,
    height: Math.abs(piece.height) * drawing.height,
    transform: isMirrored(piece) ? `${turn} ${flipAbout(x, y, piece)}` : turn,
  }
}
