import { legendAvatarUrl } from '../../guild/legend-avatar-url'
import { CardStat } from '../StatCells'
import { type EsportsResult, eventDate, formatSetRecord, ordinal, placementColour } from './esports-format'

// each part only when it says something: brawltools leaves the venue out for some events
export function eventFacts(result: EsportsResult): string {
  const venue = result.isOnline ? null : 'LAN'
  const kind = result.isOfficial ? 'Official' : null

  return [eventDate(result.startTime), result.mode, venue, kind].filter(Boolean).join(' · ')
}

/** The hover card of a result: the event's full facts, and the legend played there when the sets name it. */
export function ResultCard({ result }: { result: EsportsResult }) {
  return (
    <>
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="leading-snug font-bold text-strong">{result.heading}</div>
          <div className="mt-0.5 font-mono text-xs text-soft">{eventFacts(result)}</div>
        </div>
        {result.legendKey && (
          <img
            src={legendAvatarUrl(result.legendKey)}
            alt=""
            className="size-10 shrink-0 rounded-md bg-raised object-cover object-top"
          />
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <CardStat label="Place">
          <span className={placementColour(result.placement)}>{ordinal(result.placement)}</span>
        </CardStat>
        {result.setRecord && <CardStat label="Sets">{formatSetRecord(result.setRecord)}</CardStat>}
      </div>
    </>
  )
}
