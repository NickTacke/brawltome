import type { LeaderboardRecentActivityOutput } from '@brawltome/contracts'

export type QueueMessage = { title: string; body: string }

/** What to show in place of the table, or null when there are players to list. */
export function queueMessage(view: LeaderboardRecentActivityOutput): QueueMessage | null {
  if (view.status === 'unavailable' && view.reason === 'not_enough_history') {
    return {
      title: 'Not enough history yet',
      body: 'The queue needs an hour of leaderboard scans before it can show who played.',
    }
  }

  if (view.status === 'unavailable') {
    return { title: 'A scan was missed', body: "We can't compare this hour. It'll be back after the next scan." }
  }

  if (view.entries.length > 0) return null

  if (view.totalRows > 0) return { title: 'No one on this page', body: 'Fewer people played this hour.' }

  return { title: 'Nobody played', body: 'No ranked games in this bracket and region in the last hour.' }
}
