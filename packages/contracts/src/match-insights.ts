import {
  knockoutSchema,
  momentSchema,
  playerActionSchema,
  punishSchema,
  reviewStopSchema,
} from './match-insights-moments'
import { playerInsightSchema } from './match-insights-players'
import { stageSchema } from './match-insights-stage'
import { insightExtrasSchema, insightSummarySchema } from './match-insights-summary'
import { z } from './zod'

// everything the match page shows about a parsed match, worked out once from its stored line on the server, so the
// page and its tests read the same numbers

// the lead is sampled this often, from the start of the match
export const ADVANTAGE_SAMPLE_MS = 500

// the damage a stock is worth in the lead: the median damage players were KO'd at across the first sample replays
export const ADVANTAGE_STOCK_DAMAGE = 165

const insightsSchema = z
  .object({
    punishes: z.array(punishSchema),
    // in the order they happened
    moments: z.array(momentSchema),
    actions: z.array(playerActionSchema),
    knockouts: z.array(knockoutSchema),
    players: z.array(playerInsightSchema),
    stage: stageSchema,
    firstBloodMs: z.number().int().nonnegative().nullable(),
    // the stock lead passing from one side to the other; level scores in between don't count
    leadChanges: z.number().int().nonnegative(),
  })
  .strict()

export const matchInsightsSchema = z
  .object({
    // bumped when a figure is worked out differently, so stored insights are worked out again
    version: z.literal(1),
    summary: insightSummarySchema,
    extras: insightExtrasSchema,
    insights: insightsSchema,
    // the first player's side's lead in stocks: their stocks left minus the damage on the current one, against the
    // other side's. a stock in play counts at most 0.95 spent. one sample every ADVANTAGE_SAMPLE_MS from the start,
    // and a last one at durationMs, after the final KO, when it falls between two
    advantage: z.array(z.number()),
    reviewStops: z.array(reviewStopSchema),
  })
  .strict()
  .meta({ id: 'MatchInsights' })

export type Insights = z.infer<typeof insightsSchema>
export type MatchInsights = z.infer<typeof matchInsightsSchema>
