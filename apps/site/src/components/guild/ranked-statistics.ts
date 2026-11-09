import type { PlayerRankedSummaryContract } from '@brawltome/contracts'
import { formatWhole } from '../../lib'
import type { RankedMember } from './roster'

export type RatedMember = RankedMember & { elo: number }
export type Band = { from: number; count: number }
export type Readout = { slots: [Band | null, Band | null]; activeSlot: 0 | 1 | null }
export type RankedRecord = { wins: number; games: number; players: number }

export const bandSize = 50

const axisStep = 500
const leaderboardSize = 5
const minimumRecordPlayers = 5
const recordWindowMs = 30 * 24 * 60 * 60 * 1000
// well above the highest rating anyone has reached, one bad stored value would otherwise draw thousands of bars
const maximumPlausibleRating = 4000

export function ratedMembers(members: RankedMember[]): RatedMember[] {
  return members.flatMap((member) => {
    if (member.elo === null || member.elo > maximumPlausibleRating) return []

    return [{ ...member, elo: member.elo }]
  })
}

export function averageRating(rated: RatedMember[]): number {
  const total = rated.reduce((sum, member) => sum + member.elo, 0)

  return Math.round(total / rated.length)
}

export function topRated(rated: RatedMember[]): RatedMember[] {
  return [...rated].sort((left, right) => right.elo - left.elo).slice(0, leaderboardSize)
}

function bandStart(rating: number): number {
  return Math.floor(rating / bandSize) * bandSize
}

export function ratingBands(ratings: number[]): Band[] {
  if (ratings.length === 0) return []

  const countByStart = new Map<number, number>()

  for (const rating of ratings) {
    const start = bandStart(rating)

    countByStart.set(start, (countByStart.get(start) ?? 0) + 1)
  }

  const starts = [...countByStart.keys()].sort((left, right) => left - right)
  const first = starts[0] ?? 0
  const last = starts.at(-1) ?? 0
  const bands: Band[] = []

  for (let from = first; from <= last; from += bandSize) bands.push({ from, count: countByStart.get(from) ?? 0 })

  return bands
}

export function tallestBandCount(bands: Band[]): number {
  return bands.reduce((tallest, { count }) => Math.max(tallest, count), 0)
}

export function axisTicks(start: number, end: number): number[] {
  const ticks: number[] = []

  for (let tick = Math.ceil(start / axisStep) * axisStep; tick < end; tick += axisStep) ticks.push(tick)

  return ticks
}

export function bandSummary({ from, count }: Band): string {
  const noun = count === 1 ? 'player' : 'players'

  return `${formatWhole(from)}–${formatWhole(from + bandSize - 1)} · ${formatWhole(count)} ${noun}`
}

export function nextReadout(readout: Readout, band: Band): Readout {
  const { slots, activeSlot } = readout

  if (activeSlot !== null && slots[activeSlot]?.from === band.from) return readout

  // the new text goes in the hidden slot, so the old one can fade out while it fades in
  const hiddenSlot = activeSlot === 0 ? 1 : 0
  const nextSlots: Readout['slots'] = [...slots]

  nextSlots[hiddenSlot] = band

  return { slots: nextSlots, activeSlot: hiddenSlot }
}

function isWithinRecordWindow(updatedAt: string | null, now: Date): boolean {
  if (updatedAt === null) return false

  return now.getTime() - new Date(updatedAt).getTime() <= recordWindowMs
}

/** The summed record of members with games and a row updated in the last 30 days. */
export function rankedRecord(summaries: PlayerRankedSummaryContract[], now: Date): RankedRecord {
  const counted = summaries.filter(({ games, updatedAt }) => games > 0 && isWithinRecordWindow(updatedAt, now))

  return {
    wins: counted.reduce((sum, { wins }) => sum + wins, 0),
    games: counted.reduce((sum, { games }) => sum + games, 0),
    players: counted.length,
  }
}

// rounded here so the colour agrees with the number on the page
export function winRatePercent({ wins, games, players }: RankedRecord): number | null {
  if (players < minimumRecordPlayers || games === 0) return null

  return Math.round((wins / games) * 1000) / 10
}

export function winRateColour(percent: number): string {
  if (percent >= 60) return 'text-emerald-400'

  return percent >= 50 ? 'text-primary' : 'text-soft'
}
