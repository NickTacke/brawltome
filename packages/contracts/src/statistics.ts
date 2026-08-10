import { leaderboardRegions } from './leaderboard'
import { z } from './zod'

export const legendMetaRegions = ['all', ...leaderboardRegions] as const
export const legendMetaBrackets = ['all', 'Platinum', 'Diamond+'] as const

export const legendMetaRegionSchema = z.enum(legendMetaRegions)
export const legendMetaBracketSchema = z.enum(legendMetaBrackets)
export const legendMetaInputSchema = z
  .object({
    region: legendMetaRegionSchema,
    bracket: legendMetaBracketSchema,
  })
  .strict()

const utcDateTimeSchema = z.iso
  .datetime({ offset: false })
  .regex(/Z$/, 'date-time must use the UTC Z suffix')
  .meta({ format: 'date-time' })
const nonnegativeSafeInteger = z.int().min(0).max(Number.MAX_SAFE_INTEGER)
const basisPointsSchema = z.int().min(0).max(10_000)

const exactRatioSchema = z
  .object({
    numerator: nonnegativeSafeInteger,
    denominator: nonnegativeSafeInteger,
    basisPoints: basisPointsSchema.nullable(),
  })
  .strict()
  .superRefine((ratio, context) => {
    if (ratio.numerator > ratio.denominator) {
      context.addIssue({ code: 'custom', message: 'ratio numerator cannot exceed denominator' })
    }
    const expected = ratio.denominator === 0 ? null : Math.round((ratio.numerator * 10_000) / ratio.denominator)
    if (ratio.basisPoints !== expected) {
      context.addIssue({ code: 'custom', message: 'basis points must reproduce the exact ratio' })
    }
  })

function wilsonInterval95(wins: number, games: number) {
  if (games === 0) return null
  const z = 1.959963984540054
  const probability = wins / games
  const zSquared = z * z
  const denominator = 1 + zSquared / games
  const center = (probability + zSquared / (2 * games)) / denominator
  const margin = (z * Math.sqrt((probability * (1 - probability) + zSquared / (4 * games)) / games)) / denominator
  return {
    lowerBasisPoints: Math.max(0, Math.floor((center - margin) * 10_000)),
    upperBasisPoints: Math.min(10_000, Math.ceil((center + margin) * 10_000)),
  }
}

const uncertaintySchema = z
  .object({
    lowerBasisPoints: basisPointsSchema,
    upperBasisPoints: basisPointsSchema,
  })
  .strict()
  .refine(({ lowerBasisPoints, upperBasisPoints }) => lowerBasisPoints <= upperBasisPoints, {
    message: 'uncertainty lower bound cannot exceed upper bound',
  })

const legendSchema = z
  .object({
    legendId: z.int().positive().max(2_147_483_647),
    name: z.string().min(1).max(100),
    slug: z.string().min(1).max(100),
  })
  .strict()

const eligibleSchema = z.object({ status: z.literal('eligible') }).strict()
const insufficientSchema = z
  .object({
    status: z.literal('insufficient-sample'),
    minimumPlayers: z.literal(30),
    minimumGames: z.literal(200),
  })
  .strict()

const legendMetaRowSchema = z
  .object({
    legend: legendSchema,
    rank: z.int().positive().max(2_147_483_647).nullable(),
    eligibility: z.union([eligibleSchema, insufficientSchema]),
    playerCount: nonnegativeSafeInteger,
    gameCount: nonnegativeSafeInteger,
    winCount: nonnegativeSafeInteger,
    medianRating: z
      .number()
      .min(0)
      .max(2_147_483_647)
      .refine((value) => Number.isInteger(value * 2), 'median rating must be an integer or half-integer')
      .nullable(),
    pickShare: exactRatioSchema,
    adoption: exactRatioSchema,
    winRate: exactRatioSchema,
    uncertainty95: uncertaintySchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.winCount > row.gameCount) {
      context.addIssue({ code: 'custom', message: 'win count cannot exceed game count' })
    }
    if (row.winRate.numerator !== row.winCount || row.winRate.denominator !== row.gameCount) {
      context.addIssue({ code: 'custom', message: 'win rate must reproduce row wins and games' })
    }
    const eligible = row.playerCount >= 30 && row.gameCount >= 200
    if (eligible !== (row.eligibility.status === 'eligible')) {
      context.addIssue({ code: 'custom', message: 'eligibility must reproduce fixed player and game minimums' })
    }
    if ((eligible && row.rank === null) || (!eligible && row.rank !== null)) {
      context.addIssue({ code: 'custom', message: 'only eligible rows can receive a rank' })
    }
    const expectedUncertainty = wilsonInterval95(row.winCount, row.gameCount)
    if (
      row.uncertainty95?.lowerBasisPoints !== expectedUncertainty?.lowerBasisPoints ||
      row.uncertainty95?.upperBasisPoints !== expectedUncertainty?.upperBasisPoints
    ) {
      context.addIssue({ code: 'custom', message: 'uncertainty must reproduce the fixed 95% Wilson interval' })
    }
  })

const methodologySchema = z
  .object({
    population: z.literal('deterministic-observed-cohort'),
    seasonalScope: z.literal('Cumulative current-season ranked 1v1 values observed during the collection window.'),
    formulas: z
      .object({
        pickShare: z.literal('Observed legend games divided by all observed legend games in the selected filter.'),
        adoption: z.literal(
          'Observed players with games on the legend divided by players with a successful ranked observation in the selected filter.',
        ),
        winRate: z.literal('Observed legend wins divided by observed legend games, weighted by games.'),
        medianRating: z.literal('Median current 1v1 player rating among observed players with games on the legend.'),
        coverage: z.literal('Successful ranked observations divided by selected Observed Cohort players.'),
        uncertainty: z.literal('95% Wilson score interval over observed legend wins and games.'),
      })
      .strict(),
    eligibility: z
      .object({
        minimumPlayers: z.literal(30),
        minimumGames: z.literal(200),
        rule: z.literal('A row needs both minimums to receive a comparative rank.'),
      })
      .strict(),
    trends: z
      .object({
        status: z.literal('disabled'),
        reason: z.literal('season-identity-unavailable'),
      })
      .strict(),
    caveats: z.tuple([
      z.literal('BrawlTome-observed values are not exhaustive or live.'),
      z.literal('Missing source observations reduce coverage and are not counted as zero games.'),
      z.literal('The source does not expose a stable season identity, so cross-publication trends are unavailable.'),
      z.literal('Observed win rate describes this cohort and does not establish legend strength or causation.'),
    ]),
  })
  .strict()

const filterSchema = z
  .object({
    region: legendMetaRegionSchema,
    bracket: legendMetaBracketSchema,
  })
  .strict()

const availableFields = {
  snapshotId: z.uuid(),
  generationId: z.uuid(),
  methodologyVersion: z.literal('current-season-legend-meta-v1'),
  cohortMethodologyVersion: z.string().min(1).max(200),
  sourceGenerationId: z.uuid(),
  sourceObservedAt: utcDateTimeSchema,
  observationWindow: z
    .object({ startsAt: utcDateTimeSchema, endsAt: utcDateTimeSchema })
    .strict()
    .refine(({ startsAt, endsAt }) => Date.parse(startsAt) < Date.parse(endsAt), {
      message: 'observation window end must follow its start',
    }),
  publishedAt: utcDateTimeSchema,
  expectedNextPublicationAt: utcDateTimeSchema,
  season: z
    .object({
      scope: z.literal('current-season'),
      identity: z.null(),
      source: z.literal('brawlhalla-v1-ranked-1v1'),
    })
    .strict(),
  filter: filterSchema,
  selectedPlayers: nonnegativeSafeInteger,
  observedPlayers: nonnegativeSafeInteger,
  observedLegendGames: nonnegativeSafeInteger,
  coverage: exactRatioSchema,
  methodology: methodologySchema,
  rows: z.array(legendMetaRowSchema),
} as const

function availableSchema(status: 'fresh' | 'stale') {
  return z
    .object({
      status: z.literal(status),
      staleReason: status === 'fresh' ? z.null() : z.enum(['latest_build_failed', 'publication_overdue']),
      ...availableFields,
    })
    .strict()
    .superRefine((output, context) => {
      if (output.observedPlayers > output.selectedPlayers) {
        context.addIssue({ code: 'custom', message: 'observed players cannot exceed selected players' })
      }
      if (
        output.coverage.numerator !== output.observedPlayers ||
        output.coverage.denominator !== output.selectedPlayers
      ) {
        context.addIssue({ code: 'custom', message: 'coverage must reproduce observed and selected players' })
      }
      if (output.rows.reduce((total, row) => total + row.gameCount, 0) !== output.observedLegendGames) {
        context.addIssue({ code: 'custom', message: 'row games must reproduce all observed legend games' })
      }
      for (const row of output.rows) {
        if (row.pickShare.numerator !== row.gameCount || row.pickShare.denominator !== output.observedLegendGames) {
          context.addIssue({ code: 'custom', message: 'pick share must reproduce row and total legend games' })
        }
        if (row.adoption.numerator !== row.playerCount || row.adoption.denominator !== output.observedPlayers) {
          context.addIssue({ code: 'custom', message: 'adoption must reproduce row and observed player counts' })
        }
      }
    })
}

const unavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: z.literal('not_yet_published'),
    filter: filterSchema,
  })
  .strict()

export const legendMetaOutputSchema = z.union([availableSchema('fresh'), availableSchema('stale'), unavailableSchema])

export type LegendMetaInput = z.infer<typeof legendMetaInputSchema>
export type LegendMetaOutput = z.infer<typeof legendMetaOutputSchema>

export function parseLegendMetaOutput(value: unknown): LegendMetaOutput {
  return legendMetaOutputSchema.parse(value)
}
