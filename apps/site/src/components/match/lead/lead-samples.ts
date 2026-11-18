import type { MatchInsights } from '@brawltome/contracts'
import { ADVANTAGE_SAMPLE_MS, ADVANTAGE_STOCK_DAMAGE } from '@brawltome/contracts/match-insights-rules'

export const leadRule = `Stocks left minus damage on the current stock, added up per side. A stock counts as ${ADVANTAGE_STOCK_DAMAGE} damage, the typical KO damage in our replays.`

/** The lead along the match for the picked player's side. The insights give it for the first player's side. */
export function leadSamplesFor(insights: MatchInsights, slot: number): number[] {
  const firstSide = insights.summary.players[0]?.side
  const pickedSide = insights.summary.players.find((player) => player.slot === slot)?.side

  if (pickedSide === firstSide) return insights.advantage

  return insights.advantage.map((lead) => -lead)
}

/** The sample at a time of the match; the last one past the end. */
export function leadAt(samples: number[], timeMs: number): number {
  const index = Math.min(Math.round(timeMs / ADVANTAGE_SAMPLE_MS), samples.length - 1)

  return samples[index] ?? 0
}

/** The lead in stocks, as `+1.2`; a lead too small to round to a tenth has no sign. */
export function formatLead(lead: number): string {
  const rounded = Math.abs(lead).toFixed(1)

  if (rounded === '0.0') return rounded

  return `${lead > 0 ? '+' : '−'}${rounded}`
}

/** What a lead means, under its figure. */
export function standingOf(lead: number): string {
  if (formatLead(lead) === '0.0') return 'level'

  return lead > 0 ? 'stocks ahead' : 'stocks behind'
}
