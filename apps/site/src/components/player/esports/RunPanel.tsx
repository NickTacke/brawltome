import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { legendAvatarUrl } from '../../guild/legend-avatar-url'
import { statLabel } from '../player-styles'
import { type EsportsResult, type EsportsSet, formatSetRecord, ordinal, placementColour } from './esports-format'
import { eventFacts } from './ResultCard'

type Opponent = EsportsSet['opponents'][number]

// brawltools can't tie every opponent to an account, and those stay plain text
function OpponentName({ opponent }: { opponent: Opponent }) {
  if (opponent.brawlhallaId === null) return opponent.name

  return (
    <Link
      to="/player/$id"
      params={{ id: String(opponent.brawlhallaId) }}
      className="transition-colors hover:text-primary"
    >
      {opponent.name}
    </Link>
  )
}

function OpponentNames({ set }: { set: EsportsSet }) {
  return (
    <>
      {set.opponents.map((opponent, index) => (
        <span key={`${opponent.name}-${opponent.brawlhallaId}`}>
          {index > 0 && ' & '}
          <OpponentName opponent={opponent} />
        </span>
      ))}
    </>
  )
}

// one set of the run; the opponent's legend sits on the right, so every score and name starts at the same place
function SetCell({ set }: { set: EsportsSet }) {
  return (
    <li className="flex min-h-12 min-w-0 items-center gap-2 rounded-md bg-raised/70 py-1.5 pr-1.5 pl-2.5">
      <div className="min-w-0 flex-1">
        <div
          className={`font-mono text-[0.9375rem] leading-tight font-black tabular-nums ${set.isWin ? 'text-win' : 'text-red-400'}`}
        >
          {set.score}
        </div>
        <div className="truncate text-xs font-semibold text-text">
          <OpponentNames set={set} />
        </div>
      </div>
      {set.opponentLegendKey && (
        <img
          src={legendAvatarUrl(set.opponentLegendKey)}
          alt=""
          className="size-9 shrink-0 rounded bg-raised object-cover object-top"
        />
      )}
    </li>
  )
}

type RunPanelProps = { result: EsportsResult; onClose: () => void }

/** The way through one event, first round first, read left to right like a bracket path. */
export function RunPanel({ result, onClose }: RunPanelProps) {
  return (
    <div>
      <div className="flex items-center gap-3">
        {result.legendKey && (
          <img
            src={legendAvatarUrl(result.legendKey)}
            alt=""
            className="size-11 shrink-0 rounded-md bg-raised object-cover object-top"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="leading-snug font-bold text-strong sm:text-lg">{result.heading}</div>
          <div className="font-mono text-[0.8125rem] text-soft sm:text-sm">
            <span className={`font-black ${placementColour(result.placement)}`}>{ordinal(result.placement)}</span> ·{' '}
            {eventFacts(result)}
          </div>
        </div>
        {result.setRecord && (
          <div className="shrink-0 text-right">
            <div className={statLabel}>Sets</div>
            <div className="font-mono font-bold text-strong">{formatSetRecord(result.setRecord)}</div>
          </div>
        )}
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="self-start text-soft transition-colors hover:text-strong"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <ol className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
        {result.sets.map((set) => (
          <SetCell key={set.id} set={set} />
        ))}
      </ol>
    </div>
  )
}
