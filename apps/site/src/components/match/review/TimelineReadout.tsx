import type { Knockout, Moment } from '@brawltome/contracts'
import { LegendMark } from '../LegendMark'
import { formatClock, formatDamage } from '../match-format'
import { damageColour } from '../match-styles'
import type { Pose } from '../stage/pose'
import { weaponIconName } from '../weapon-icon'
import { knockoutMove, zoneNames } from './knockout-text'
import type { LanePlayer } from './lane-players'
import { classLabels } from './moment-class'
import { damageAt, damageText } from './timeline-readout'

type TimelineReadoutProps = {
  timeMs: number
  lanes: LanePlayer[]
  // where the players are at the time, for what they hold; none until the timeline loads
  poses: Pose[]
  // the exchange and the KO next to the pointer, when there is one
  moment: Moment | null
  knockout: Knockout | null
}

type PlayerNowProps = { lane: LanePlayer; pose: Pose | undefined; timeMs: number }

// a player at the pointer's time: who, what they hold, and their damage in the game's colour for it
function PlayerNow({ lane, pose, timeMs }: PlayerNowProps) {
  const damage = damageAt(lane.stocks, timeMs)
  const icon = pose && damage !== null ? weaponIconName(pose.weapon) : null

  return (
    <span className="flex items-center gap-1.5" data-player={lane.player.name}>
      <LegendMark player={lane.player} slot={lane.player.slot} className="size-5 rounded-sm" />
      {icon ? <img src={`/images/weapons/${icon}.svg`} alt="" className="size-4" /> : null}
      <span
        className="min-w-6 font-mono font-bold tabular-nums"
        style={{ color: damage === null ? undefined : damageColour(damage) }}
      >
        {damageText(lane.stocks, timeMs)}
      </span>
    </span>
  )
}

// the exchange under the pointer, as its class and cost, and a KO as who went out at what, to which move and where
function eventsAt(moment: Moment | null, knockout: Knockout | null, lanes: LanePlayer[]): string[] {
  const nameOf = (slot: number) => lanes.find((lane) => lane.player.slot === slot)?.player.name ?? `Player ${slot}`

  const exchange =
    moment && moment.hits.length > 0
      ? `${classLabels[moment.class]} · ${formatDamage(moment.damage)} on ${nameOf(moment.victim)}`
      : null

  const out = knockout
    ? `${nameOf(knockout.victim)} out at ${formatDamage(knockout.damage)} · ${knockoutMove(knockout)} · ${zoneNames[knockout.zone].toLowerCase()}`
    : null

  return [exchange, out].filter((line): line is string => line !== null)
}

/**
 * What the timeline says at the pointer, on one low line so it covers little of the stage: the clock, everyone's
 * weapon and damage, and under it the exchange or KO there.
 */
export function TimelineReadout({ timeMs, lanes, poses, moment, knockout }: TimelineReadoutProps) {
  const events = eventsAt(moment, knockout, lanes)

  return (
    <div
      data-timeline-readout
      className="rounded-control border border-line bg-ink px-2.5 py-1.5 text-sm whitespace-nowrap shadow-xl"
    >
      <div className="flex items-center gap-3.5">
        <span className="font-mono text-xs text-soft tabular-nums">{formatClock(timeMs)}</span>
        {lanes.map((lane) => (
          <PlayerNow
            key={lane.player.slot}
            lane={lane}
            pose={poses.find((pose) => pose.slot === lane.player.slot)}
            timeMs={timeMs}
          />
        ))}
      </div>
      {events.map((line) => (
        <div key={line} className="mt-1 text-xs text-text">
          {line}
        </div>
      ))}
    </div>
  )
}
