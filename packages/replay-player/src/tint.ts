// How the game colours a player on top of their animation, worked out from a bh-native replay line. No Node APIs.
//
// The game's drawing (patch 11.00) colours each player once a frame, after the frame's steps, from their state then:
// a colour transform on the player's sprite, each channel times a multiplier plus an offset, the alpha left alone.
// It runs in the drawing, not the step, so it isn't in the line as the game shows it (a replay draws a frame every 60
// steps); the line has the state it reads, and tintAt plays the rule at any step, as the game shows it one step a
// frame. Its first match wins:
//
// - after a respawn (status 5, until the player starts a move or 2.5 s pass): white plus 0x666666 while the game's
//   clock is in the first 100 ms of every 300, nothing between: a blink;
// - while the player can't be hit (the game's own test, which the line records: a dodge's protected part, among
//   others): white plus 0x333333;
// - for 175 ms after a hit taken, the hit's time included: times 0x555555 plus the damage's colour, from 0xaaaaaa at
//   0 through 0xaaaa00, 0xaa6600, 0xaa0000, 0x7f0000 and 0x5d0000 every 50 damage to 0x310000 from 300, in a straight
//   line between two, each channel cut to a whole number. The damage is the player's now, not at the hit;
// - with both air jumps used: times 0xbbbbbb plus 0x111111, a darker player;
// - otherwise none.
//
// The game also tints for modes and settings the lines don't cover (volleyball, horde, the tutorial, the training
// room's cooldowns and debug view); tintAt leaves those out.

import { valueAt } from './steps.ts'
import type { Timeline } from './timeline.ts'

// Tint is a colour transform: each channel (0 to 1) times multiply, plus add / 255, as the game's shader does it
export type Tint = { multiply: [number, number, number]; add: [number, number, number] }

export const RESPAWN_BLINK = { periodMs: 300, onMs: 100 } as const
export const HIT_FLASH_MS = 175
export const MAX_AIR_JUMPS = 2
export const DAMAGE_OFFSETS = [0xaaaaaa, 0xaaaa00, 0xaa6600, 0xaa0000, 0x7f0000, 0x5d0000, 0x310000] as const
const DAMAGE_STEP = 50

const channels = (colour: number): [number, number, number] => [
  (colour >>> 16) & 255,
  (colour >>> 8) & 255,
  colour & 255,
]

// tintOf is the tint the game's tint call makes from its two colours: the multiplier's channels over 255, the offset's
export function tintOf(multiply: number, add: number): Tint {
  const m = channels(multiply)

  return { multiply: [m[0] / 255, m[1] / 255, m[2] / 255], add: channels(add) }
}

const WHITE = 0xffffff
const RESPAWN = tintOf(WHITE, 0x666666)
const INVULNERABLE = tintOf(WHITE, 0x333333)
const OUT_OF_JUMPS = tintOf(0xbbbbbb, 0x111111)
const DAMAGE_MULTIPLY = 0x555555

// damageColour is the colour a hit flashes for a damage, as the game blends two of its colours
export function damageColour(damage: number): number {
  const wholeDamage = Math.trunc(damage)
  const last = DAMAGE_OFFSETS.length - 1
  const band = Math.min(Math.floor(Math.max(0, wholeDamage) / DAMAGE_STEP), last)

  if (band === last) return DAMAGE_OFFSETS[last]

  const along = (wholeDamage - band * DAMAGE_STEP) / DAMAGE_STEP
  const from = channels(DAMAGE_OFFSETS[band])
  const to = channels(DAMAGE_OFFSETS[band + 1])

  // the game weighs the first colour by w = 1 - along and the second by 1 - w (not along: the two differ in the last
  // bit, which the cut to a whole number can show), and cuts each channel to a whole number
  const firstWeight = 1 - along
  const mixed = from.map((channel, i) => Math.trunc(channel * firstWeight + to[i] * (1 - firstWeight)))

  return (mixed[0] << 16) | (mixed[1] << 8) | mixed[2]
}

// isBlinkOn says whether the game's clock is in the lit part of the respawn blink
const isBlinkOn = (timeMs: number) =>
  Math.floor(timeMs / RESPAWN_BLINK.onMs) % (RESPAWN_BLINK.periodMs / RESPAWN_BLINK.onMs) === 0

// hasTints says whether a line records what the tint reads
export const hasTints = (timeline: Timeline) => timeline.stepZeroTime !== undefined

// tintAt is the tint the game draws a player with right after a step (a fractional step uses the step before), or
// undefined for none, also for a line without the fields
export function tintAt(timeline: Timeline, slot: string | number, step: number): Tint | undefined {
  const state = timeline.state[String(slot)]

  if (!state || timeline.stepZeroTime === undefined) return undefined

  const whole = Math.floor(step)
  const stepMs = timeline.stepMs ?? 16
  const timeMs = timeline.stepZeroTime + stepMs * whole

  if (valueAt(state.afterRespawn, whole)) return isBlinkOn(timeMs) ? RESPAWN : undefined

  if (valueAt(state.invulnerable, whole)) return INVULNERABLE

  const hitStep = valueAt(state.lastHit, whole)

  if (hitStep !== undefined && timeline.stepZeroTime + stepMs * hitStep + HIT_FLASH_MS >= timeMs) {
    return tintOf(DAMAGE_MULTIPLY, damageColour(valueAt(state.damage, whole) ?? 0))
  }

  if ((valueAt(state.airJumpsUsed, whole) ?? 0) >= MAX_AIR_JUMPS) return OUT_OF_JUMPS

  return undefined
}

// tintKey names a tint, as two colours (multiplier/offset), for comparing with the game's
export function tintKey(tint: Tint | undefined): string {
  if (!tint) return '-'

  const hex = (channels: number[]) => channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')
  const multiplier = tint.multiply.map((channel) => Math.round(channel * 255))

  return `${hex(multiplier)}/${hex(tint.add)}`
}
