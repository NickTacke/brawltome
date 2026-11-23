import { TimelineScrubber } from './TimelineScrubber'

type FoldedTimelineProps = {
  timeMs: number
  durationMs: number
  onSeek: (timeMs: number) => void
}

/**
 * The lanes folded away: the whole match as one thin line, filled up to the clock, with the playhead's knob on it.
 * The scrubber over it is as high as the bar's row, so it is as easy to grab as the lanes were.
 */
export function FoldedTimeline({ timeMs, durationMs, onSeek }: FoldedTimelineProps) {
  const playedPercent = (Math.min(timeMs / durationMs, 1) * 100).toFixed(2)

  return (
    <div data-folded-timeline className="relative mx-1.5 flex h-8 items-center phone:h-11">
      <span className="h-1 w-full rounded-full bg-strong/15" />
      <span className="absolute left-0 h-1 rounded-full bg-strong/40" style={{ width: `${playedPercent}%` }} />
      <span
        className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full bg-strong"
        style={{ left: `${playedPercent}%` }}
      />
      <TimelineScrubber label="Match time" timeMs={timeMs} durationMs={durationMs} onSeek={onSeek} />
    </div>
  )
}
