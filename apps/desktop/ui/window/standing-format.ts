import { isInPlacement, knownTier, PLACEMENT_GAMES, tierLabel } from '../overlay/card-format'
import type { OwnResult, OwnStanding } from './app-status'

export type TodayResults = { wins: number; losses: number; ratingChange: number }

// memory gives the elo and games, so the tier is the base tier of the elo, as on the overlay cards
export function ownTier(you: OwnStanding): string | null {
  return knownTier(you)
}

// 'Diamond', or 'Placement 3/10' while the game still places the player
export function ownRankText(you: OwnStanding): string {
  if (isInPlacement(you)) return `Placement ${you.games}/${PLACEMENT_GAMES}`

  return tierLabel(ownTier(you) ?? 'none')
}

// the ranked 1v1 results since local midnight; null when there are none
export function todayResults(results: OwnResult[], nowMs: number): TodayResults | null {
  const today = new Date(nowMs).toDateString()
  const todays = results.filter((result) => new Date(result.atMs).toDateString() === today)

  if (todays.length === 0) return null

  const wins = todays.filter((result) => result.isWin).length
  const ratingChange = todays.reduce((sum, result) => sum + result.ratingChange, 0)

  return { wins, losses: todays.length - wins, ratingChange }
}
