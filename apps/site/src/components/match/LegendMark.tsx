import type { CSSProperties } from 'react'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { slotColour } from './match-styles'

type LegendMarkProps = {
  player: { legendKey: string; name: string }
  slot: number
  // the size and corners, as classes: a lane's mark is not a scoreboard's
  className?: string
  // true where the name stands right beside the picture
  isDecorative?: boolean
}

/**
 * A player as their legend's portrait, ringed in the colour that is theirs all over the page: on the stage, along
 * the timeline and in every table.
 */
export function LegendMark({ player, slot, className = 'size-6 rounded-md', isDecorative = false }: LegendMarkProps) {
  const ring = { '--tw-ring-color': slotColour(slot) } as CSSProperties

  return (
    <img
      src={legendAvatarUrl(player.legendKey)}
      alt={isDecorative ? '' : player.name}
      title={isDecorative ? undefined : player.name}
      className={`shrink-0 bg-raised object-cover object-top ring-2 ${className}`}
      style={ring}
    />
  )
}
