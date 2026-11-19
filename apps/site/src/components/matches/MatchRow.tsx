import type { MatchSummaryContract } from '@brawltome/contracts'
import { Link } from '@tanstack/react-router'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { smallCaps } from '../player/player-styles'
import {
  ordinal,
  queueLabel,
  type RowPlayer,
  type RowResult,
  type RowView,
  resultFor,
  rowViewOf,
  shortAgo,
} from './match-row-model'

// one match as a fixture line: every row puts its map, its sides, its score and its result on the same tracks, so
// the scores run in one line down the page
const rowTracks =
  'grid h-16 items-center gap-x-4 grid-cols-[5.5rem_minmax(11rem,1fr)_minmax(0,18rem)_4rem_minmax(0,18rem)_3.5rem]'

const rowHover = '-mx-3 rounded-md px-3 transition-colors hover:bg-white/[0.04]'

type MatchRowProps = { match: MatchSummaryContract; yourId: number | null; now: Date }

export function MatchRow({ match, yourId, now }: MatchRowProps) {
  const view = rowViewOf(match, yourId)
  const result = resultFor(match, yourId)
  const linkProps = { to: '/match/$id', params: { id: match.id } } as const

  return (
    <li className="border-t border-line/30 first:border-t-0">
      <Link {...linkProps} className={`${rowTracks} ${rowHover} max-md:hidden`}>
        <MapPicture url={match.mapPictureUrl} className="h-12 w-[5.5rem]" />
        <MatchName match={match} now={now} />
        <Sides view={view} yourId={yourId} />
        <div className="text-right">{result && <ResultLabel result={result} />}</div>
      </Link>
      <Link
        {...linkProps}
        className={`grid h-16 grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-3 md:hidden ${rowHover}`}
      >
        <MapPicture url={match.mapPictureUrl} className="h-10 w-16" />
        <PhoneMiddle match={match} view={view} yourId={yourId} now={now} />
        <PhoneScore view={view} result={result} />
      </Link>
    </li>
  )
}

function MapPicture({ url, className }: { url: string | null; className: string }) {
  if (!url) return <div className={`shrink-0 rounded-md bg-raised ${className}`} />

  return <img src={url} alt="" loading="lazy" className={`shrink-0 rounded-md bg-raised object-cover ${className}`} />
}

function MatchName({ match, now }: { match: MatchSummaryContract; now: Date }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-bold text-strong">{queueLabel(match)}</div>
      <div className="truncate text-sm text-soft">
        {match.mapName} · {shortAgo(match.parsedAt, now)}
      </div>
    </div>
  )
}

function Portrait({
  player,
  yourId,
  className = 'size-8',
}: {
  player: RowPlayer
  yourId: number | null
  className?: string
}) {
  const ring = player.brawlhallaId === yourId ? 'ring-2 ring-strong' : ''

  return (
    <img
      src={legendAvatarUrl(player.legendKey)}
      alt={`${player.name} as ${player.legendName}`}
      title={`${player.name} · ${player.legendName}`}
      className={`shrink-0 rounded-md bg-raised object-cover object-top ${ring} ${className}`}
    />
  )
}

function Sides({ view, yourId }: { view: RowView; yourId: number | null }) {
  if (view.kind === 'freeForAll') {
    return (
      <div className="col-span-3 flex justify-center gap-2">
        {view.placed.map((player) => (
          <Portrait key={player.slot} player={player} yourId={yourId} />
        ))}
      </div>
    )
  }

  return (
    <>
      <Side players={view.first} yourId={yourId} align="right" />
      <Score first={view.firstScore} second={view.secondScore} />
      <Side players={view.second} yourId={yourId} align="left" />
    </>
  )
}

// portraits touch the score and names sit outside them; the visitor's own name would repeat on every row, so it's left out
function Side({ players, yourId, align }: { players: RowPlayer[]; yourId: number | null; align: 'left' | 'right' }) {
  const named = players.filter((player) => player.brawlhallaId !== yourId)
  const isRight = align === 'right'

  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${isRight ? 'flex-row-reverse text-right' : ''}`}>
      <div className={`flex shrink-0 gap-1 ${isRight ? 'flex-row-reverse' : ''}`}>
        {players.map((player) => (
          <Portrait key={player.slot} player={player} yourId={yourId} />
        ))}
      </div>
      <div className="min-w-0">
        {named.map((player) => (
          <div key={player.slot} className="truncate text-sm leading-tight font-semibold text-text">
            {player.name}
          </div>
        ))}
      </div>
    </div>
  )
}

function Score({ first, second }: { first: number; second: number }) {
  return (
    <div className="text-center text-xl font-black tracking-tight whitespace-nowrap tabular-nums">
      <span className={first >= second ? 'text-strong' : 'text-soft'}>{first}</span>
      <span className="px-0.5 text-soft/50">–</span>
      <span className={second >= first ? 'text-strong' : 'text-soft'}>{second}</span>
    </div>
  )
}

function ResultLabel({ result }: { result: RowResult }) {
  if (result.kind === 'place') {
    const colour = result.place === 1 ? 'text-emerald-400' : 'text-soft'

    return <span className={`${smallCaps} ${colour}`}>{ordinal(result.place)}</span>
  }

  const words = { won: 'Won', lost: 'Lost', draw: 'Draw' } as const

  return (
    <span className={`${smallCaps} ${result.kind === 'won' ? 'text-emerald-400' : 'text-soft'}`}>
      {words[result.kind]}
    </span>
  )
}

type PhoneMiddleProps = { match: MatchSummaryContract; view: RowView; yourId: number | null; now: Date }

// a phone keeps the queue, the portraits and the score; names wait for the match page
function PhoneMiddle({ match, view, yourId, now }: PhoneMiddleProps) {
  const groups = view.kind === 'versus' ? [view.first, view.second] : view.placed.map((player) => [player])

  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-bold text-strong">
        {queueLabel(match)} <span className="font-normal text-soft">· {shortAgo(match.parsedAt, now)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {groups.map((group) => (
          <div key={group.map((player) => player.slot).join()} className="flex gap-0.5">
            {group.map((player) => (
              <Portrait key={player.slot} player={player} yourId={yourId} className="size-6" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function PhoneScore({ view, result }: { view: RowView; result: RowResult | null }) {
  const score =
    view.kind === 'versus' ? (
      <div className="[&>div]:text-lg">
        <Score first={view.firstScore} second={view.secondScore} />
      </div>
    ) : null

  return (
    <div className="text-right">
      {score}
      {result && <ResultLabel result={result} />}
    </div>
  )
}
