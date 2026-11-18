import type { Stock } from '@brawltome/contracts'
import { sectionBody, sectionTitle, statLabel } from '../player/player-styles'
import { WinBar } from '../player/WinBar'
import { LegendMark } from './LegendMark'
import { formatDamage, formatDecimal, formatShare } from './match-format'
import type { MatchPlayer } from './match-players'
import { WonAndLost } from './WonAndLost'

function StockRow({ stock }: { stock: Stock }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[0.8125rem] whitespace-nowrap tabular-nums">
        <span>
          <span className={`mr-1.5 ${statLabel}`}>Stock {stock.index + 1}</span>{' '}
          <WonAndLost won={stock.openingsWon} lost={stock.openingsLost} />
        </span>
        <span className="text-soft">
          <span className="font-bold text-strong">{formatDamage(stock.damageDealt)}</span> dealt ·{' '}
          <span className="font-bold text-strong">{formatDamage(stock.damageTaken)}</span> taken
        </span>
      </div>
      <WinBar wins={stock.openingsWon} games={stock.openingsWon + stock.openingsLost} />
    </div>
  )
}

function NeutralHeading({ matchPlayer }: { matchPlayer: MatchPlayer }) {
  const { player, slot } = matchPlayer

  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className={sectionTitle}>Neutral</h2>
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">
        <LegendMark player={player} slot={slot} className="size-5 rounded-md" isDecorative />
        <span className="truncate">{player.name}</span>
      </span>
    </div>
  )
}

/**
 * The picked player's neutral game: the share of openings they won over the match with what an opening was worth to
 * them, and the same stock by stock, so a slump or a comeback shows. An opening is won by whoever lands the first hit
 * of an exchange.
 */
export function NeutralByStock({ matchPlayer }: { matchPlayer: MatchPlayer }) {
  const { neutral, stocks } = matchPlayer.insight
  const openings = neutral.openingsWon + neutral.openingsLost
  const wonShare = openings > 0 ? neutral.openingsWon / openings : null

  return (
    <section>
      <NeutralHeading matchPlayer={matchPlayer} />
      <div className={sectionBody}>
        <div className="mb-2 flex items-baseline justify-between gap-3 whitespace-nowrap tabular-nums">
          <span className="flex items-baseline gap-2.5 text-[0.8125rem]">
            <span className="text-[1.75rem] leading-8 font-bold text-strong">{formatShare(wonShare)}</span>
            <WonAndLost won={neutral.openingsWon} lost={neutral.openingsLost} hasKey />
          </span>
          <span className="text-[0.8125rem] text-soft">
            <span className="text-base font-bold text-strong">{formatDecimal(neutral.damagePerOpening)}</span> per
            opening
          </span>
        </div>
        <WinBar wins={neutral.openingsWon} games={openings} />
        <div className="mt-4 space-y-2.5">
          {stocks.map((stock) => (
            <StockRow key={stock.index} stock={stock} />
          ))}
        </div>
      </div>
    </section>
  )
}
