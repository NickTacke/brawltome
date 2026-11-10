import { type ReactNode, useEffect, useRef, useState } from 'react'
import { formatWhole } from '../../lib'
import { placeColours, sectionTitleStyle } from './guild-styles'
import { LegendAvatar } from './LegendAvatar'
import { PlayerLink } from './PlayerLink'
import {
  averageRating,
  axisTicks,
  type Band,
  bandSize,
  bandSummary,
  nextReadout,
  type RankedRecord,
  type RatedMember,
  type Readout,
  ratedMembers,
  ratingBands,
  tallestBandCount,
  topRated,
  winRateColour,
  winRatePercent,
} from './ranked-statistics'
import type { RankedMember } from './roster'

const diamondMinRating = 2000
const readoutShowDelayMs = 100
const readoutHideDelayMs = 250

function barColour({ from }: Band): string {
  return from >= diamondMinRating ? 'bg-primary/75' : 'bg-soft/35'
}

function barHeight(count: number, tallest: number): string {
  return count === 0 ? '0' : `max(0.1875rem, ${(count / tallest) * 100}%)`
}

// waits for the mouse to settle on a bar, so sweeping across the chart doesn't start a fade per bar
function useBandReadout() {
  const [readout, setReadout] = useState<Readout>({ slots: [null, null], activeSlot: null })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function schedule(update: (current: Readout) => Readout, delayMs: number) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setReadout(update), delayMs)
  }

  return {
    readout,
    showBand: (band: Band) => schedule((current) => nextReadout(current, band), readoutShowDelayMs),
    hideBand: () => schedule((current) => ({ ...current, activeSlot: null }), readoutHideDelayMs),
  }
}

function FadingLine({ isVisible, children }: { isVisible: boolean; children: ReactNode }) {
  const opacity = isVisible ? 'opacity-100' : 'opacity-0'

  return (
    <span
      className={`absolute inset-0 truncate transition-opacity duration-300 ease-out ${opacity}`}
      aria-hidden={!isVisible}
    >
      {children}
    </span>
  )
}

function bandText(band: Band | null): string {
  return band ? bandSummary(band) : ''
}

function Summary({ average, record }: { average: number; record: RankedRecord }) {
  const winRate = winRatePercent(record)

  return (
    <>
      {formatWhole(average)} average elo
      {winRate !== null && (
        <>
          {' · '}
          <span className={`font-semibold ${winRateColour(winRate)}`}>{winRate.toFixed(1)}%</span> win rate
        </>
      )}
    </>
  )
}

type RatingChartProps = {
  bands: Band[]
  average: number
  onBandEnter: (band: Band) => void
  onChartLeave: () => void
}

function RatingChart({ bands, average, onBandEnter, onChartLeave }: RatingChartProps) {
  const tallest = tallestBandCount(bands)
  const start = bands[0]?.from ?? 0
  const end = (bands.at(-1)?.from ?? 0) + bandSize
  const percentOf = (rating: number) => ((rating - start) / (end - start)) * 100

  return (
    <div className="mt-6">
      <div className="relative h-14 border-b border-line/70">
        <ul aria-label="Members by 1v1 elo" className="flex h-full gap-0.5" onMouseLeave={onChartLeave}>
          {bands.map((band) => (
            <li
              key={band.from}
              onMouseEnter={() => onBandEnter(band)}
              className="group flex h-full min-w-0 flex-1 items-end"
            >
              {band.count > 0 && <span className="sr-only">{bandSummary(band)}</span>}
              <div
                className={`w-full rounded-t-[0.1875rem] transition-colors duration-200 group-hover:bg-primary ${barColour(band)}`}
                style={{ height: barHeight(band.count, tallest) }}
              />
            </li>
          ))}
        </ul>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-strong ring-2 ring-ink"
          style={{ left: `${percentOf(average)}%` }}
        >
          <span className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 font-mono text-[0.6875rem] leading-none whitespace-nowrap text-strong">
            avg
          </span>
        </div>
      </div>
      <div className="relative mt-1.5 h-4 font-mono text-xs text-soft">
        {axisTicks(start, end).map((tick) => (
          <span
            key={tick}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${percentOf(tick)}%` }}
          >
            {formatWhole(tick)}
          </span>
        ))}
      </div>
    </div>
  )
}

// the last rows only show when the window is tall enough for the sticky column, and the new last row loses its line
const rowHeightRules: Record<number, string> = {
  3: '[@media(max-height:999px)]:border-b-0',
  4: '[@media(max-height:999px)]:hidden',
  5: '[@media(max-height:999px)]:hidden',
}

function LeaderboardRow({ member, place }: { member: RatedMember; place: number }) {
  const heightRule = rowHeightRules[place] ?? ''

  return (
    <li
      className={`group relative flex h-[2.625rem] items-center gap-3 border-b border-line/25 text-sm last:border-b-0 ${heightRule}`}
    >
      <span className={`w-3 shrink-0 font-mono ${placeColours[place] ?? 'text-soft'}`}>{place}</span>
      <LegendAvatar legend={member.mainLegend} />
      <PlayerLink
        playerId={member.brawlhallaId}
        className="min-w-0 flex-1 truncate font-semibold text-strong transition-colors group-hover:text-primary after:absolute after:inset-0"
      >
        {member.displayName}
      </PlayerLink>
      <span className="shrink-0 font-mono font-semibold text-strong">{formatWhole(member.elo)}</span>
    </li>
  )
}

// short screens drop this section, so the sticky column never runs past the bottom of the window
export function RankedStatistics({ members, record }: { members: RankedMember[]; record: RankedRecord }) {
  const { readout, showBand, hideBand } = useBandReadout()
  const rated = ratedMembers(members)

  if (rated.length === 0) return null

  const average = averageRating(rated)
  const bands = ratingBands(rated.map(({ elo }) => elo))

  return (
    <section className="hidden min-w-0 border-t border-line/70 pt-7 xl:block xl:[@media(max-height:779px)]:hidden">
      <h2 className={sectionTitleStyle}>Ranked statistics</h2>
      <p className="relative mt-1 h-5 text-sm text-soft tabular-nums">
        <FadingLine isVisible={readout.activeSlot === null}>
          <Summary average={average} record={record} />
        </FadingLine>
        <FadingLine isVisible={readout.activeSlot === 0}>{bandText(readout.slots[0])}</FadingLine>
        <FadingLine isVisible={readout.activeSlot === 1}>{bandText(readout.slots[1])}</FadingLine>
      </p>
      <RatingChart bands={bands} average={average} onBandEnter={showBand} onChartLeave={hideBand} />
      <ul className="mt-3 [@media(max-height:909px)]:hidden">
        {topRated(rated).map((member, index) => (
          <LeaderboardRow key={member.brawlhallaId} member={member} place={index + 1} />
        ))}
      </ul>
    </section>
  )
}
