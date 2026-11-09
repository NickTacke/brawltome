import { type MouseEvent, useId, useState } from 'react'
import { formatDay } from '../../lib'
import { ActivityBars } from './ActivityBars'
import { axisDates, ratingAxisTicks, ratingRange, smoothPath } from './chart-geometry'
import { formatGrouped, ratingBands, tierColour } from './player-format'
import { type ChartPoint, highestPoint } from './rating-seasons'

const lowestTierLabelPercent = 92
const markerLabelGapPercent = { x: 20, y: 12 }
const axisDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

type Scale = { xPercent: (time: number) => number; yPercent: (rating: number) => number }

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

// hard stops, so the line changes colour exactly where it crosses into a tier
function TierGradient({ id, yPercent, high }: { id: string; yPercent: Scale['yPercent']; high: number }) {
  const stops = ratingBands.flatMap((band, index) => {
    const upperRating = ratingBands[index - 1]?.rating ?? Number.POSITIVE_INFINITY
    const start = upperRating > high ? 0 : clampPercent(yPercent(upperRating))
    const end = band.rating === 0 ? 100 : clampPercent(yPercent(band.rating))

    return [
      { offset: start, colour: band.colour },
      { offset: end, colour: band.colour },
    ]
  })

  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
      {stops.map(({ offset, colour }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stops never reorder
        <stop key={index} offset={`${offset}%`} stopColor={colour} />
      ))}
    </linearGradient>
  )
}

type MarkerProps = { x: number; y: number; colour: string; label: string; isBelow?: boolean }

function markerAlignment(x: number): string {
  if (x > 82) return 'right-0'

  return x < 18 ? 'left-0' : '-translate-x-1/2'
}

function Marker({ x, y, colour, label, isBelow = false }: MarkerProps) {
  return (
    <div className="pointer-events-none absolute" style={{ left: `${x}%`, top: `${y}%` }}>
      <div
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink"
        style={{ backgroundColor: colour }}
      />
      <div
        className={`absolute w-max font-mono text-xs font-semibold text-strong ${isBelow ? 'top-2.5' : 'bottom-2.5'} ${markerAlignment(x)}`}
      >
        {label}
      </div>
    </div>
  )
}

function PeakAndLastMarkers({ points, xPercent, yPercent }: Scale & { points: ChartPoint[] }) {
  const peak = highestPoint(points)
  const last = points.at(-1) as ChartPoint

  const isLastFarFromPeak =
    Math.abs(xPercent(last.time) - xPercent(peak.time)) > markerLabelGapPercent.x ||
    Math.abs(yPercent(last.rating) - yPercent(peak.rating)) > markerLabelGapPercent.y

  return (
    <>
      <Marker
        x={xPercent(peak.time)}
        y={yPercent(peak.rating)}
        colour={tierColour(peak.tier)}
        label={formatGrouped(peak.rating)}
      />
      {last !== peak && (
        <Marker
          x={xPercent(last.time)}
          y={yPercent(last.rating)}
          colour={tierColour(last.tier)}
          label={isLastFarFromPeak ? formatGrouped(last.rating) : ''}
          isBelow
        />
      )}
    </>
  )
}

function ChartGuides({ yPercent, low, high }: { yPercent: Scale['yPercent']; low: number; high: number }) {
  const visibleTiers = ratingBands.filter(({ rating }) => rating > low && rating < high)
  const axisTicks = ratingAxisTicks(low, high).filter((tick) => yPercent(tick) > 6 && yPercent(tick) < 94)

  return (
    <>
      {visibleTiers.map(({ name, rating, colour }) => (
        <div
          key={name}
          className="pointer-events-none absolute inset-x-0 border-t border-dashed"
          style={{ top: `${yPercent(rating)}%`, borderColor: `${colour}55` }}
        >
          {yPercent(rating) < lowestTierLabelPercent && (
            <span className="absolute top-1 right-0 text-[11px] leading-none font-bold text-soft">{name}</span>
          )}
        </div>
      ))}
      {axisTicks.map((tick) => (
        <div
          key={tick}
          className="pointer-events-none absolute inset-x-0 border-t border-line/20"
          style={{ top: `${yPercent(tick)}%` }}
        >
          <span className="absolute -top-1.5 -left-12 w-10 text-right font-mono text-[11px] leading-none text-soft/60">
            {formatGrouped(tick)}
          </span>
        </div>
      ))}
    </>
  )
}

function ChartLine({ line, yPercent, high }: { line: string; yPercent: Scale['yPercent']; high: number }) {
  const gradientId = `tier-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <TierGradient id={gradientId} yPercent={yPercent} high={high} />
        <linearGradient id={`${gradientId}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.3" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={`${gradientId}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill={`url(#${gradientId}-fade)`} />
        </mask>
      </defs>
      <path d={`${line} L 100 100 L 0 100 Z`} fill={`url(#${gradientId})`} mask={`url(#${gradientId}-mask)`} />
      <path
        d={line}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChangeSincePrevious({ hovered, previous }: { hovered: ChartPoint; previous: ChartPoint | undefined }) {
  if (!previous || hovered.rating === previous.rating) return null

  const change = hovered.rating - previous.rating

  return (
    <span className={`text-xs ${change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
      {change > 0 ? '+' : '−'}
      {formatGrouped(Math.abs(change))}
    </span>
  )
}

type HoverReadoutProps = Scale & { hovered: ChartPoint; previous: ChartPoint | undefined }

function HoverReadout({ hovered, previous, xPercent, yPercent }: HoverReadoutProps) {
  const isTooltipOnLeft = xPercent(hovered.time) > 72

  return (
    <div className="pointer-events-none absolute inset-y-0" style={{ left: `${xPercent(hovered.time)}%` }}>
      <div className="absolute inset-y-0 w-px bg-soft/50" />
      <div
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink"
        style={{ top: `${yPercent(hovered.rating)}%`, backgroundColor: tierColour(hovered.tier) }}
      />
      <div
        className={`absolute top-1 w-max rounded-control bg-ink px-2.5 py-1.5 text-sm ring-1 ring-line ${isTooltipOnLeft ? 'right-3' : 'left-3'}`}
      >
        <div className="font-mono font-semibold text-strong">
          {formatGrouped(hovered.rating)} <ChangeSincePrevious hovered={hovered} previous={previous} />
        </div>
        <div className="text-xs text-soft">
          {hovered.tier} · {formatDay(hovered.recordedAt)}
        </div>
        <div className="font-mono text-xs text-soft">
          {formatGrouped(hovered.wins)}W {formatGrouped(hovered.games - hovered.wins)}L
        </div>
      </div>
    </div>
  )
}

function nearestIndex(xPositions: number[], percent: number): number {
  let nearest = 0

  xPositions.forEach((x, index) => {
    if (Math.abs(x - percent) < Math.abs((xPositions[nearest] ?? 0) - percent)) nearest = index
  })

  return nearest
}

export function RatingChart({ points, heightClass }: { points: ChartPoint[]; heightClass: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const start = points[0]?.time ?? 0
  const end = points.at(-1)?.time ?? 1
  const { low, high } = ratingRange(points)
  const xPercent = (time: number) => (end === start ? 0 : ((time - start) / (end - start)) * 100)
  const yPercent = (rating: number) => 100 - ((rating - low) / (high - low)) * 100
  const scale = { xPercent, yPercent }
  const coordinates = points.map((point) => ({ x: xPercent(point.time), y: yPercent(point.rating) }))
  const hovered = hoveredIndex === null ? null : (points[hoveredIndex] ?? null)
  const previous = hoveredIndex === null ? undefined : points[hoveredIndex - 1]

  function hoverNearestPoint(event: MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const percent = ((event.clientX - box.left) / box.width) * 100

    setHoveredIndex(
      nearestIndex(
        coordinates.map(({ x }) => x),
        percent,
      ),
    )
  }

  return (
    <div className="min-w-0">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only readout, the markers and axis carry the same numbers */}
      <div
        className={`relative ml-12 border-b border-line/70 ${heightClass}`}
        onMouseMove={hoverNearestPoint}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <ChartGuides yPercent={yPercent} low={low} high={high} />
        <ChartLine line={smoothPath(coordinates)} yPercent={yPercent} high={high} />
        {!hovered && <PeakAndLastMarkers points={points} {...scale} />}
        {hovered && <HoverReadout hovered={hovered} previous={previous} {...scale} />}
      </div>
      <ActivityBars points={points} start={start} end={end} hoveredTime={hovered?.time ?? null} />
      <div className="mt-1.5 ml-12 flex justify-between font-mono text-xs text-soft">
        {axisDates(start, end).map((time) => (
          <span key={time}>{axisDateFormat.format(new Date(time))}</span>
        ))}
      </div>
    </div>
  )
}
