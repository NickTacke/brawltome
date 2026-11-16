import { LegendMark } from './LegendMark'
import type { MatchPlayer } from './match-players'
import { StockPips } from './StockPips'

type PlayerPickProps = {
  matchPlayer: MatchPlayer
  isPicked: boolean
  stocks: number
  // lower rows for a match of four, so the column still fits a laptop's screen
  isCompact: boolean
  onPick: () => void
}

/**
 * A player as a row to pick: their legend in their own colour, the one they have all over the replay, their name,
 * and the stocks they had left. The whole row is the button; the page turns towards the one that is picked.
 */
export function PlayerPick({ matchPlayer, isPicked, stocks, isCompact, onPick }: PlayerPickProps) {
  const { player, slot } = matchPlayer
  const rowHeight = isCompact ? 'py-1.5' : 'py-2'
  const look = isPicked ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'

  return (
    <button
      type="button"
      aria-pressed={isPicked}
      onClick={onPick}
      className={`-mx-3 flex w-[calc(100%+1.5rem)] cursor-pointer items-center gap-3 rounded-lg px-3 text-left transition-colors ${rowHeight} ${look}`}
    >
      <LegendMark
        player={player}
        slot={slot}
        className={`rounded-lg ${isCompact ? 'size-9' : 'size-10'}`}
        isDecorative
      />
      <span className="min-w-0 flex-1">
        <span className={`block truncate leading-tight font-bold ${isPicked ? 'text-strong' : 'text-text'}`}>
          {player.name}
        </span>
        <span className="mt-0.5 block truncate text-sm leading-tight text-soft">{player.legendName}</span>
      </span>
      {stocks > 0 ? <StockPips left={player.stocksLeft} total={stocks} /> : null}
    </button>
  )
}
