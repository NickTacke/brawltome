import type { StageBox } from '@brawltome/contracts'
import { positionAt, type Timeline } from '@brawltome/replay-player'
import { stepAt } from './playback-timeline'

// a pose is what the stage shows of one player at one moment besides their legend: where they are, which way they
// face, what they hold, and their damage and stocks. tokens draw it whole; the legends' tags read it

export type Pose = {
  slot: number
  // shares of the stage box; outside 0 to 1 when the player is off screen
  x: number
  y: number
  // false between a KO and the respawn
  isInPlay: boolean
  facingRight: boolean
  weapon: string
  isHitstun: boolean
  isDodging: boolean
  damage: number
  stocksLeft: number
}

type Changes<Value> = [number, Value][]

// the state the trimmed timeline keeps for each player, besides what the replay player itself reads
type PlayerState = {
  status?: Changes<string>
  facingRight?: Changes<boolean>
  weapon?: Changes<string>
  damage?: Changes<number>
  stocks?: Changes<number>
  hitstun?: Changes<boolean>
  dodging?: Changes<boolean>
}

/** The value a list of changes holds at a step: the last change at or before it. */
export function valueAt<Value>(changes: Changes<Value> | undefined, step: number, fallback: Value): Value {
  if (!changes) return fallback

  let low = 0
  let high = changes.length - 1
  let found = fallback

  while (low <= high) {
    const middle = (low + high) >> 1
    const change = changes[middle] as [number, Value]

    if (change[0] > step) {
      high = middle - 1
      continue
    }

    found = change[1]
    low = middle + 1
  }

  return found
}

// the game holds a player in place for a moment at times; they are still in play then
function isInPlayAt(state: PlayerState, step: number): boolean {
  const status = valueAt(state.status, step, '')

  return status === 'live' || status === 'held'
}

function poseOf(timeline: Timeline, slot: string, box: StageBox, step: number): Pose | null {
  const position = positionAt(timeline, slot, step)
  const state = timeline.state[slot] as PlayerState | undefined

  if (!position || !state) return null

  const whole = Math.floor(step)

  return {
    slot: Number(slot),
    x: (position.x - box.minX) / box.width,
    y: (position.y - box.minY) / box.height,
    isInPlay: isInPlayAt(state, whole),
    facingRight: valueAt(state.facingRight, whole, true),
    weapon: valueAt(state.weapon, whole, 'Unarmed'),
    isHitstun: valueAt(state.hitstun, whole, false),
    isDodging: valueAt(state.dodging, whole, false),
    damage: valueAt(state.damage, whole, 0),
    stocksLeft: valueAt(state.stocks, whole, 0),
  }
}

/** Every player's pose at a time of the page's clock, in the order of their slots. */
export function posesAt(timeline: Timeline, box: StageBox, timeMs: number): Pose[] {
  const step = stepAt(timeline, timeMs)
  const slots = Object.keys(timeline.state).sort((left, right) => Number(left) - Number(right))

  return slots.flatMap((slot) => poseOf(timeline, slot, box, step) ?? [])
}
