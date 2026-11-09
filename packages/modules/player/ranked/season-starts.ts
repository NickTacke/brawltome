import type { SeasonStartContract } from '@brawltome/contracts'

export type DailyGameCountDrops = { day: string; drops: number; points: number }

const firstKnownSeason: SeasonStartContract = { season: 39, startsAt: new Date(0).toISOString() }

export const firstDetectedSeason = 40

// measured on production history: 5 to 14% of points late in a season, 27 to 36% on the day of a reset
const minimumDrops = 30
const minimumDropShare = 0.25

// players first seen long after a reset keep the share high for weeks
const minimumSeasonDays = 60

const dayMs = 24 * 60 * 60 * 1000
const wednesday = 3
const seasonStartHourUtc = 14

function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`)
}

function isResetDay({ drops, points }: DailyGameCountDrops): boolean {
  return drops >= minimumDrops && drops / points >= minimumDropShare
}

// seasons have started on wednesdays at 14:00 utc, and the first falling counts can be seen days later
function wednesdayStartOnOrBefore(day: string): string {
  const startMs = dayStartMs(day)
  const daysSinceWednesday = (new Date(startMs).getUTCDay() + 7 - wednesday) % 7

  return new Date(startMs - daysSinceWednesday * dayMs + seasonStartHourUtc * 60 * 60 * 1000).toISOString()
}

function isFarEnoughFrom(previous: SeasonStartContract, day: string): boolean {
  if (previous.season === firstKnownSeason.season) return true

  return dayStartMs(day) - Date.parse(previous.startsAt) >= minimumSeasonDays * dayMs
}

/** Season starts, oldest first, from how many stored game counts fell on each day. Days must be in order. */
export function detectSeasonStarts(days: DailyGameCountDrops[]): SeasonStartContract[] {
  const seasons = [firstKnownSeason]

  for (const day of days) {
    const previous = seasons[seasons.length - 1]

    if (!isResetDay(day) || !isFarEnoughFrom(previous, day.day)) continue

    const season = previous.season === firstKnownSeason.season ? firstDetectedSeason : previous.season + 1

    seasons.push({ season, startsAt: wednesdayStartOnOrBefore(day.day) })
  }

  return seasons
}
