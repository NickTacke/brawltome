import type { OverlayPosition } from './app-status'

type Spot = { position: OverlayPosition; label: string }

// row by row, the order the stage's grid lays them out
const spots: Spot[] = [
  { position: 'topLeft', label: 'Top left' },
  { position: 'topCenter', label: 'Top centre' },
  { position: 'topRight', label: 'Top right' },
  { position: 'middleLeft', label: 'Middle left' },
  { position: 'center', label: 'Centre' },
  { position: 'middleRight', label: 'Middle right' },
  { position: 'bottomLeft', label: 'Bottom left' },
  { position: 'bottomCenter', label: 'Bottom centre' },
  { position: 'bottomRight', label: 'Bottom right' },
]

type PositionPickerProps = { position: OverlayPosition; onChange: (position: OverlayPosition) => void }

// the game's screen in miniature, with a card where the overlay will show up
export function PositionPicker({ position, onChange }: PositionPickerProps) {
  return (
    <div className="stage" role="radiogroup" aria-label="Overlay spot">
      {spots.map((spot) => {
        const isChosen = spot.position === position

        return (
          <button
            type="button"
            role="radio"
            className="spot"
            aria-label={spot.label}
            aria-checked={isChosen}
            key={spot.position}
            onClick={() => onChange(spot.position)}
          >
            {isChosen ? <CardOutline position={spot.position} /> : <span className="spot-mark" />}
          </button>
        )
      })}
    </div>
  )
}

// the app hangs the banner on the side nearest the screen edge, so cards on the right carry it on their right
function CardOutline({ position }: { position: OverlayPosition }) {
  const bannerSide = position.endsWith('Right') ? 'right' : 'left'

  return (
    <span className="card-outline" data-banner-side={bannerSide}>
      <span className="card-banner" />
    </span>
  )
}
