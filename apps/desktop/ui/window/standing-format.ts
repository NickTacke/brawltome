import { isInPlacement, knownTier, PLACEMENT_GAMES, tierLabel } from '../overlay/card-format'
import type { OwnStanding, RecentMatch } from './app-status'

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

// the matches of this run played on the same day as now that have a result; null when there are none
export function todayResults(matches: RecentMatch[], nowMs: number): TodayResults | null {
  const today = new Date(nowMs).toDateString()

  const results = matches.filter(
    (recentMatch) =>
      recentMatch.isWin !== null &&
      recentMatch.ratingChange !== null &&
      new Date(recentMatch.startedAtMs).toDateString() === today,
  )

  if (results.length === 0) return null

  const wins = results.filter((recentMatch) => recentMatch.isWin === true).length
  const ratingChange = results.reduce((sum, recentMatch) => sum + (recentMatch.ratingChange ?? 0), 0)

  return { wins, losses: results.length - wins, ratingChange }
}
