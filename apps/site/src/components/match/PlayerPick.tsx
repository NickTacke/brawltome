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
 * and the stocks they had left. The row is the button; the page turns towards the one that is picked. Their profile
 * is a link of its own at the end, so picking never leaves the page.
 */
export function PlayerPick({ matchPlayer, isPicked, stocks, isCompact, onPick }: PlayerPickProps) {
  const { player, slot } = matchPlayer
  const rowHeight = isCompact ? 'py-1.5' : 'py-2'
  const look = isPicked ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'

  return (
    <div className={`-mx-3 flex w-[calc(100%+1.5rem)] items-center rounded-lg pr-3 transition-colors ${look}`}>
      <button
        type="button"
        aria-pressed={isPicked}
        onClick={onPick}
        className={`flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg pl-3 text-left ${rowHeight}`}
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
      <a
        href={`/player/${player.brawlhallaId}`}
        aria-label={`${player.name}’s profile`}
        className="ml-3 shrink-0 text-xs font-semibold text-soft transition-colors hover:text-strong hover:underline"
      >
        Profile
      </a>
    </div>
  )
}
