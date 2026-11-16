import type { MatchInsights } from '@brawltome/contracts'

/** The queue and size a match was played in, as players say it: `Ranked 2v2`. */
export function queueName({ summary, extras }: MatchInsights): string {
  const sides = new Set(summary.players.map((player) => player.side)).size
  const perSide = summary.players.length / Math.max(sides, 1)
  const size = `${perSide}v${perSide}`

  if (extras.isRanked) return `Ranked ${size}`

  return extras.queue === 'unranked' ? `Unranked ${size}` : `Custom ${size}`
}
