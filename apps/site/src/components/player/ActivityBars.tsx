import { activityBars, hoveredActivityBar } from './chart-geometry'
import type { ChartPoint } from './rating-seasons'

type ActivityBarsProps = { points: ChartPoint[]; start: number; end: number; hoveredTime: number | null }

export function ActivityBars({ points, start, end, hoveredTime }: ActivityBarsProps) {
  const bars = activityBars(points, start, end)
  const tallest = Math.max(...bars)

  if (tallest === 0) return null

  const hoveredBar = hoveredActivityBar(hoveredTime, start, end)

  return (
    <div data-activity className="ml-12" aria-hidden="true">
      <div className="mt-1 text-[0.6875rem] leading-none font-bold text-soft/70">Games played</div>
      <div className="mt-0.5 flex h-6 items-end gap-px">
        {bars.map((played, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the bars are fixed time slots
            key={index}
            className={`flex-1 rounded-t-[0.125rem] transition-colors duration-150 ${index === hoveredBar ? 'bg-primary' : 'bg-soft/30'}`}
            style={{ height: played === 0 ? 0 : `max(0.125rem, ${(played / tallest) * 100}%)` }}
          />
        ))}
      </div>
    </div>
  )
}
