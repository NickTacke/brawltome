import type { LevelLayout, MatchInsights } from '@brawltome/contracts'
import { readAdvantage } from './advantage'
import { readExtras } from './extras'
import { readFacts } from './facts'
import { readInsights } from './insights'
import { lineSchema } from './line'
import { isInsightMatch } from './match-kind'
import { readRecord } from './record'
import { readReviewStops } from './review-stops'
import { readSummary } from './summary'

// bumped when a figure is worked out differently, so stored insights are worked out again
export const INSIGHTS_VERSION = 1 satisfies MatchInsights['version']

/**
 * Everything the match page shows, from a stored line. Null when the line isn't a stock 1v1 or 2v2 with a timeline;
 * throws when it is one but its timeline isn't the shape format 1 promises.
 */
export function readMatchInsights(line: unknown, layout: LevelLayout | null): MatchInsights | null {
  if (!isInsightMatch(line)) return null

  const parsed = lineSchema.safeParse(line)

  if (!parsed.success)
    throw new Error(`read match insights: the line isn't a format 1 timeline: ${parsed.error.message}`)

  const record = readRecord(parsed.data)
  const facts = readFacts(record)
  const summary = readSummary(facts)
  const insights = readInsights(facts, layout)
  const firstSide = summary.players[0]?.side ?? 0
  const standings = summary.players.map((player) => ({ side: player.side, stocks: stocksOf(insights, player.slot) }))

  return {
    version: INSIGHTS_VERSION,
    summary,
    extras: readExtras(record),
    insights,
    advantage: readAdvantage(standings, firstSide, record.line.match.rules.stocks ?? 0, summary.durationMs),
    reviewStops: readReviewStops(
      insights.moments,
      summary.players.map((player) => player.slot),
    ),
  }
}

function stocksOf(insights: MatchInsights['insights'], slot: number) {
  return insights.players.find((player) => player.slot === slot)?.stocks ?? []
}
