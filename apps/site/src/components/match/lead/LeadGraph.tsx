import { memo } from 'react'
import { formatClock } from '../match-format'
import { TimelineScrubber } from '../review/TimelineScrubber'
import { LeadCurve } from './LeadCurve'
import { leadRule } from './lead-samples'

const minuteMs = 60_000
// a KO that ends the match is drawn just short of the end, where the whole dot still shows
const lastMarkShare = 0.985

// a KO along the match, in the colour of who went out
export type LeadMark = { timeMs: number; colour: string }

type AlongProps = { durationMs: number; isUpright: boolean }

// a faint line per minute with its time, so the graph can be read against the clock
const Minutes = memo(function Minutes({ durationMs, isUpright }: AlongProps) {
  const count = Math.floor((durationMs - 1) / minuteMs)
  const times = Array.from({ length: count }, (_, index) => (index + 1) * minuteMs)

  const line = isUpright
    ? 'inset-x-0 border-t border-line/50 pt-0.5 pl-1'
    : 'inset-y-0 flex items-end border-l border-line/50 pb-0.5 pl-1'

  return times.map((timeMs) => (
    <span
      key={timeMs}
      className={`pointer-events-none absolute font-mono text-[0.625rem] leading-none text-soft/80 ${line}`}
      style={{ [isUpright ? 'top' : 'left']: `${(timeMs / durationMs) * 100}%` }}
    >
      {formatClock(timeMs)}
    </span>
  ))
})

// the KOs sit on the graph's own line, as events along the match, each in the colour of who went out
const Knockouts = memo(function Knockouts({ marks, durationMs, isUpright }: AlongProps & { marks: LeadMark[] }) {
  return marks.map((mark) => (
    <span
      key={`${mark.timeMs}-${mark.colour}`}
      className={`pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink ${isUpright ? 'left-1/2' : 'top-1/2'}`}
      style={{
        [isUpright ? 'top' : 'left']: `${Math.min(mark.timeMs / durationMs, lastMarkShare) * 100}%`,
        backgroundColor: mark.colour,
      }}
    />
  ))
})

export type LeadGraphProps = {
  // who is ahead along the match, for the picked player
  samples: number[]
  colour: string
  marks: LeadMark[]
  timeMs: number
  durationMs: number
  onSeek: (timeMs: number) => void
  // beside the stage the match runs from top to bottom; under it, from left to right
  isUpright: boolean
}

/**
 * Who is ahead across the match, in the picked player's colour, with the KOs along its line. A scrubber of its own:
 * click or drag along it to go there.
 */
export function LeadGraph({ samples, colour, marks, timeMs, durationMs, onSeek, isUpright }: LeadGraphProps) {
  const share = timeMs / durationMs
  const sides = isUpright ? 'Right of the line the picked side is ahead.' : 'Above the line the picked side is ahead.'
  const playhead = isUpright ? 'inset-x-0 h-0.5 -translate-y-1/2' : 'inset-y-0 w-0.5 -translate-x-1/2'

  return (
    <div className="relative size-full overflow-hidden rounded-md bg-raised/40">
      <Minutes durationMs={durationMs} isUpright={isUpright} />
      <LeadCurve samples={samples} colour={colour} isUpright={isUpright} />
      <Knockouts marks={marks} durationMs={durationMs} isUpright={isUpright} />
      <TimelineScrubber
        label="Lead over the match"
        timeMs={timeMs}
        durationMs={durationMs}
        onSeek={onSeek}
        isUpright={isUpright}
        title={`${sides} ${leadRule} The dots are KOs, in the colour of who went out.`}
      />
      <span
        className={`pointer-events-none absolute bg-strong ${playhead}`}
        style={{ [isUpright ? 'top' : 'left']: `${share * 100}%` }}
      />
    </div>
  )
}
