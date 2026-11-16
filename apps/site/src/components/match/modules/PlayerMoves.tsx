import { useState } from 'react'
import { LegendMark } from '../LegendMark'
import type { MatchPlayer } from '../match-players'
import { MoveLine } from './MoveLine'
import { type MoveSortKey, rankMoves } from './move-sorts'
import { WeaponFigure } from './WeaponFigure'

const movesShown = 5

type PlayerMovesProps = { matchPlayer: MatchPlayer; sort: MoveSortKey; isPicked: boolean; onPick: () => void }

/** One player's weapons with what they did with each, and their best moves, the rest behind a button. */
export function PlayerMoves({ matchPlayer, sort, isPicked, onPick }: PlayerMovesProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { player, slot } = matchPlayer
  const ranked = rankMoves(player.moves, sort)
  const shown = isExpanded ? ranked : ranked.slice(0, movesShown)
  const hasMoves = (weapon: string) => player.moves.some((move) => move.weapon === weapon)
  const weapons = player.weapons.filter((weapon) => weapon.isWeapon && hasMoves(weapon.weapon))

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-pressed={isPicked}
        onClick={onPick}
        className={`flex max-w-full cursor-pointer items-center gap-2.5 text-sm font-bold hover:text-strong ${isPicked ? 'text-strong' : 'text-text'}`}
      >
        <LegendMark player={player} slot={slot} isDecorative />
        <span className="truncate">{player.name}</span>
      </button>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {weapons.map((weapon) => (
          <WeaponFigure key={weapon.weapon} weapon={weapon} />
        ))}
      </div>
      <div className="mt-2 divide-y divide-line/30">
        {shown.map((move) => (
          <MoveLine key={move.key} move={move} />
        ))}
      </div>
      {ranked.length > movesShown && (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-1 text-sm font-semibold text-soft transition-colors hover:text-strong"
        >
          {isExpanded ? 'Show less' : `Show all ${ranked.length}`}
        </button>
      )}
    </div>
  )
}
