import { memo } from 'react'

// the plot's own units: along the match, and across it for the lead
const along = 1000
const across = 100
const middle = across / 2
// the curve never touches the edge of the graph
const reach = 0.86
// a match that stays level still gets a readable curve, without a tiny lead filling the graph
const smallestPeak = 0.4

type LeadCurveProps = { samples: number[]; colour: string; isUpright: boolean }

// ahead is up on the flat graph and to the right on the upright one
function areaPath(samples: number[], scale: number, keep: (value: number) => number, isUpright: boolean): string {
  const step = along / Math.max(samples.length - 1, 1)
  const point = (alongIt: number, acrossIt: number) => (isUpright ? `${acrossIt},${alongIt}` : `${alongIt},${acrossIt}`)
  const leadAt = (value: number) => (isUpright ? middle + keep(value) * scale : middle - keep(value) * scale)
  const points = samples.map((value, index) => point(index * step, leadAt(value)))

  return `M${point(0, middle)} L${points.join(' L')} L${point(along, middle)} Z`
}

/** The lead as two areas either side of level: ahead in the picked player's colour, behind in grey. */
export const LeadCurve = memo(function LeadCurve({ samples, colour, isUpright }: LeadCurveProps) {
  const peak = Math.max(smallestPeak, ...samples.map(Math.abs))
  const scale = (middle * reach) / peak
  const ahead = areaPath(samples, scale, (value) => Math.max(value, 0), isUpright)
  const behind = areaPath(samples, scale, (value) => Math.min(value, 0), isUpright)
  const axis = isUpright ? { x1: middle, x2: middle, y1: 0, y2: along } : { x1: 0, x2: along, y1: middle, y2: middle }

  return (
    <svg
      viewBox={isUpright ? `0 0 ${across} ${along}` : `0 0 ${along} ${across}`}
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
      aria-hidden="true"
    >
      <path d={ahead} fill={colour} fillOpacity={0.8} />
      <path d={behind} fill="var(--color-soft)" fillOpacity={0.4} />
      <line {...axis} stroke="var(--color-soft)" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
})
