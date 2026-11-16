import { fallsOf, type RawLine, sideOf, stateSeries, stepAt, valueAt } from './derive'

// what a player's state series say over the match: where they were, when a flag switched, their damage and standing

export function isLiveAt(line: RawLine, slot: number, step: number): boolean {
  return valueAt<string>(stateSeries(line, slot, 'status'), step, '') === 'live'
}

// whole seconds a player could act in each place, sampled every fourth step as the page samples it
export function secondsByPlace(line: RawLine, slot: number): { air: number; ground: number; wall: number } {
  const samples = { air: 0, ground: 0, wall: 0 }
  const { startStep, endStep, stepMs } = line.timeline

  for (let step = startStep; step < endStep; step += 4) {
    if (!isLiveAt(line, slot, step) || valueAt(stateSeries(line, slot, 'hitstun'), step, false)) continue

    if (valueAt(stateSeries(line, slot, 'onWall'), step, false)) samples.wall += 1
    else if (valueAt(stateSeries(line, slot, 'inAir'), step, false)) samples.air += 1
    else samples.ground += 1
  }

  const seconds = (count: number) => Math.round((count * 4 * stepMs) / 1000)

  return { air: seconds(samples.air), ground: seconds(samples.ground), wall: seconds(samples.wall) }
}

/** The steps at which a state flag switched to false, leaving out the first entry, which is no switch. */
export function switchesOff(line: RawLine, slot: number, name: string): number[] {
  const series = stateSeries(line, slot, name)

  return series.flatMap(([step, value], index) => (index > 0 && value === false ? [step] : []))
}

export function damageAt(line: RawLine, slot: number, step: number): number {
  return valueAt(stateSeries(line, slot, 'damage'), step, 0)
}

const stockDamage = 165
// a stock still in play is never worth nothing, however deep in damage
const mostSpentShare = 0.95

// stocks left, less the damage on the one in play as a share of a stock; nothing once all are gone
export function standingAt(line: RawLine, slot: number, timeMs: number): number {
  const stocks = line.match.rules.stocks
  const step = stepAt(line, timeMs)
  const lost = fallsOf(line, slot).filter((ko) => ko.step <= step).length
  const status = valueAt<string>(stateSeries(line, slot, 'status'), step, '')
  const isInPlay = status === 'live' || status === 'held'
  const spent = isInPlay ? Math.min(damageAt(line, slot, step) / stockDamage, mostSpentShare) : 0

  if (lost >= stocks) return 0

  return stocks - lost - spent
}

/** Every half second from the start, and the end of the match when it falls between two. */
export function leadTimes(durationMs: number, sampleMs: number): number[] {
  const times: number[] = []

  for (let timeMs = 0; timeMs <= durationMs; timeMs += sampleMs) times.push(timeMs)

  if (times.at(-1) !== durationMs) times.push(durationMs)

  return times
}

export function leadAt(line: RawLine, side: number, timeMs: number): number {
  return line.match.players.reduce((lead, player) => {
    const standing = standingAt(line, player.slot, timeMs)

    return sideOf(line, player.slot) === side ? lead + standing : lead - standing
  }, 0)
}

function pressedBits(previousBits: number, bits: number): number {
  return (bits & ~previousBits).toString(2).replaceAll('0', '').length
}

/** Buttons pressed over the match, and while stunned, with the seconds spent stunned. */
export function pressesOf(
  line: RawLine,
  slot: number,
): { presses: number; stunnedPresses: number; stunnedSeconds: number } {
  const hitstun = stateSeries(line, slot, 'hitstun')
  let presses = 0
  let stunnedPresses = 0
  let previousBits = 0

  for (const [step, bits] of stateSeries(line, slot, 'input') as [number, number][]) {
    const pressed = pressedBits(previousBits, bits)

    presses += pressed
    stunnedPresses += valueAt(hitstun, step, false) ? pressed : 0
    previousBits = bits
  }

  const stunnedSteps = hitstun.reduce(
    (total, [step, isStunned], index) => (isStunned ? total + (hitstun[index + 1]?.[0] ?? step) - step : total),
    0,
  )

  return { presses, stunnedPresses, stunnedSeconds: (stunnedSteps * line.timeline.stepMs) / 1000 }
}

/** The longest stretch in the air between two changes, while in play at both ends. */
export function longestAirMs(line: RawLine, slot: number): number {
  const inAir = stateSeries(line, slot, 'inAir')
  let longest = 0

  for (const [index, [step, isUp]] of inAir.entries()) {
    const until = inAir[index + 1]?.[0] ?? step

    if (isUp && isLiveAt(line, slot, step) && isLiveAt(line, slot, until)) longest = Math.max(longest, until - step)
  }

  return longest * line.timeline.stepMs
}
