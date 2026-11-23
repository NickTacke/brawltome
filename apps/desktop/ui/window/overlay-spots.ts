import type { OverlayPosition } from './app-status'

export type Spot = { position: OverlayPosition; label: string }

export type MenuAction =
  | { kind: 'move'; activeIndex: number }
  | { kind: 'choose'; position: OverlayPosition }
  | { kind: 'close' }
  | { kind: 'none' }

// the screen's thirds from the top; the menu draws a rule between them
export const spotGroups: Spot[][] = [
  [
    { position: 'topLeft', label: 'Top left' },
    { position: 'topCenter', label: 'Top centre' },
    { position: 'topRight', label: 'Top right' },
  ],
  [
    { position: 'middleLeft', label: 'Middle left' },
    { position: 'center', label: 'Centre' },
    { position: 'middleRight', label: 'Middle right' },
  ],
  [
    { position: 'bottomLeft', label: 'Bottom left' },
    { position: 'bottomCenter', label: 'Bottom centre' },
    { position: 'bottomRight', label: 'Bottom right' },
  ],
]

export const spots: Spot[] = spotGroups.flat()

const lastIndex = spots.length - 1

export function spotIndex(position: OverlayPosition): number {
  const index = spots.findIndex((spot) => spot.position === position)

  return Math.max(index, 0)
}

export function spotLabel(position: OverlayPosition): string {
  return spots[spotIndex(position)].label
}

// what a key does while the menu is open; the arrows stop at the ends, as a list box's do
export function menuAction(key: string, activeIndex: number): MenuAction {
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', activeIndex: Math.min(activeIndex + 1, lastIndex) }
    case 'ArrowUp':
      return { kind: 'move', activeIndex: Math.max(activeIndex - 1, 0) }
    case 'Home':
      return { kind: 'move', activeIndex: 0 }
    case 'End':
      return { kind: 'move', activeIndex: lastIndex }
    case 'Enter':
    case ' ':
      return { kind: 'choose', position: spots[activeIndex].position }
    case 'Escape':
    case 'Tab':
      return { kind: 'close' }
    default:
      return { kind: 'none' }
  }
}
