import type { ChartPoint } from './rating-seasons'

const axisLabelCount = 5
const verticalPadding = 0.18
const minimumPaddingRating = 40
const activityBarCount = 56

export function ratingRange(points: ChartPoint[]): { low: number; high: number } {
  const ratings = points.map((point) => point.rating)
  const low = Math.min(...ratings)
  const high = Math.max(...ratings)
  const padding = Math.max((high - low) * verticalPadding, minimumPaddingRating)

  return { low: low - padding, high: high + padding }
}

export function smoothPath(coordinates: Array<{ x: number; y: number }>): string {
  const [first, ...rest] = coordinates

  if (!first) return ''

  let path = `M ${first.x} ${first.y}`
  let previous = first

  for (const point of rest) {
    const middleX = (previous.x + point.x) / 2

    path += ` C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`
    previous = point
  }

  return path
}

export function axisDates(start: number, end: number): number[] {
  return Array.from({ length: axisLabelCount }, (_, index) => start + ((end - start) * index) / (axisLabelCount - 1))
}

export function ratingAxisTicks(low: number, high: number): number[] {
  const span = high - low
  const step = span <= 300 ? 50 : span <= 800 ? 100 : 250
  const ticks: number[] = []

  for (let tick = Math.ceil(low / step) * step; tick < high; tick += step) ticks.push(tick)

  return ticks
}

function activityBarAt(time: number, start: number, end: number): number {
  return Math.min(Math.floor(((time - start) / (end - start)) * activityBarCount), activityBarCount - 1)
}

// games are only known at each observation, so everything since the last one lands in that observation's bar
export function activityBars(points: ChartPoint[], start: number, end: number): number[] {
  const bars = Array.from({ length: activityBarCount }, () => 0)

  points.forEach((point, index) => {
    const previous = points[index - 1]
    const played = previous ? point.games - previous.games : 0

    if (played <= 0 || end === start) return

    const bar = activityBarAt(point.time, start, end)

    bars[bar] = (bars[bar] ?? 0) + played
  })

  return bars
}

export function hoveredActivityBar(hoveredTime: number | null, start: number, end: number): number {
  return hoveredTime === null ? -1 : activityBarAt(hoveredTime, start, end)
}
