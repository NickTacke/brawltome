import { leaderboardRegions } from './leaderboard'
import {
  directionFor,
  statisticsHistoryCompatibilityReasonSchema,
  statisticsHistoryDirectionSchema,
  validateExactHistoryDeltaKeys,
  validateHistoryStructure,
} from './statistics-history'
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

const methodologyCommonFields = {
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
} as const

const methodologySchema = z.union([
  z
    .object({
      ...methodologyCommonFields,
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
    .strict(),
  z
    .object({
      ...methodologyCommonFields,
      trends: z
        .object({
          status: z.literal('conditional'),
          requirement: z.literal(
            'Adjacent snapshots require the same authoritative season, cohort methodology, metric methodology, and scope.',
          ),
        })
        .strict(),
      caveats: z.tuple([
        z.literal('BrawlTome-observed values are not exhaustive or live.'),
        z.literal('Missing source observations reduce coverage and are not counted as zero games.'),
        z.literal('Cross-publication trends stop at the first incompatible adjacent snapshot.'),
        z.literal('Observed win rate describes this cohort and does not establish legend strength or causation.'),
      ]),
    })
    .strict(),
])

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
      identity: z.string().min(1).max(200).nullable(),
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
      if ((output.season.identity === null) !== (output.methodology.trends.status === 'disabled')) {
        context.addIssue({ code: 'custom', message: 'season identity must match trend methodology availability' })
      }
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

const historySnapshotSchema = z
  .object({
    snapshotId: z.uuid(),
    generationId: z.uuid(),
    methodologyVersion: z.string().min(1).max(200),
    cohortMethodologyVersion: z.string().min(1).max(200),
    observationWindow: z
      .object({ startsAt: utcDateTimeSchema, endsAt: utcDateTimeSchema })
      .strict()
      .refine(({ startsAt, endsAt }) => Date.parse(startsAt) < Date.parse(endsAt), {
        message: 'observation window end must follow its start',
      }),
    publishedAt: utcDateTimeSchema,
    season: z
      .object({
        scope: z.literal('current-season'),
        identity: z.string().min(1).max(200).nullable(),
        source: z.literal('brawlhalla-v1-ranked-1v1'),
      })
      .strict(),
    scope: filterSchema,
    selectedPlayers: nonnegativeSafeInteger,
    observedPlayers: nonnegativeSafeInteger,
    observedLegendGames: nonnegativeSafeInteger,
    coverage: exactRatioSchema,
    rows: z.array(legendMetaRowSchema).max(100),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.observedPlayers > snapshot.selectedPlayers) {
      context.addIssue({ code: 'custom', message: 'observed players cannot exceed selected players' })
    }
    if (
      snapshot.coverage.numerator !== snapshot.observedPlayers ||
      snapshot.coverage.denominator !== snapshot.selectedPlayers
    ) {
      context.addIssue({ code: 'custom', message: 'coverage must reproduce observed and selected players' })
    }
    if (snapshot.rows.reduce((total, row) => total + row.gameCount, 0) !== snapshot.observedLegendGames) {
      context.addIssue({ code: 'custom', message: 'row games must reproduce all observed legend games' })
    }
    if (new Set(snapshot.rows.map(({ legend }) => legend.legendId)).size !== snapshot.rows.length) {
      context.addIssue({ code: 'custom', message: 'Legend rows must be unique' })
    }
    for (const row of snapshot.rows) {
      if (row.pickShare.numerator !== row.gameCount || row.pickShare.denominator !== snapshot.observedLegendGames) {
        context.addIssue({ code: 'custom', message: 'pick share must reproduce row and total legend games' })
      }
      if (row.adoption.numerator !== row.playerCount || row.adoption.denominator !== snapshot.observedPlayers) {
        context.addIssue({ code: 'custom', message: 'adoption must reproduce row and observed player counts' })
      }
    }
  })

const directedBasisPointChangeSchema = z
  .object({
    changeBasisPoints: z.int().min(-10_000).max(10_000),
    direction: statisticsHistoryDirectionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.direction !== directionFor(value.changeBasisPoints)) {
      context.addIssue({ code: 'custom', message: 'history direction must reproduce the signed change' })
    }
  })

const directedRatingChangeSchema = z
  .object({
    change: z
      .number()
      .min(-2_147_483_647)
      .max(2_147_483_647)
      .refine((value) => Number.isInteger(value * 2), 'rating change must be an integer or half-integer'),
    direction: statisticsHistoryDirectionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.direction !== directionFor(value.change)) {
      context.addIssue({ code: 'custom', message: 'history direction must reproduce the signed change' })
    }
  })

const legendMetaHistoryDeltaSchema = z
  .object({
    legend: legendSchema,
    pickShare: directedBasisPointChangeSchema,
    adoption: directedBasisPointChangeSchema,
    winRate: directedBasisPointChangeSchema,
    medianRating: directedRatingChangeSchema,
  })
  .strict()

const legendMetaHistoryComparisonSchema = z.union([
  z
    .object({
      status: z.literal('available'),
      previousSnapshotId: z.uuid(),
      deltas: z.array(legendMetaHistoryDeltaSchema),
    })
    .strict(),
  z
    .object({
      status: z.literal('incompatible'),
      previousSnapshotId: z.uuid(),
      reasons: z.array(statisticsHistoryCompatibilityReasonSchema).min(1).max(4),
    })
    .strict(),
])

const legendMetaHistoryAvailableSchema = z
  .object({
    status: z.literal('available'),
    filter: filterSchema,
    entries: z
      .array(
        z
          .object({
            snapshot: historySnapshotSchema,
            comparisonToPrevious: legendMetaHistoryComparisonSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .superRefine((history, context) => {
    validateHistoryStructure(history.entries, context)
    for (let index = 0; index < history.entries.length; index += 1) {
      const entry = history.entries[index]
      if (!entry) continue
      if (
        entry.snapshot.scope.region !== history.filter.region ||
        entry.snapshot.scope.bracket !== history.filter.bracket
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Legend history snapshot scope must match requested filter',
          path: ['entries', index, 'snapshot', 'scope'],
        })
      }
      const previous = history.entries[index + 1]
      if (!previous || entry.comparisonToPrevious?.status !== 'available') continue
      const previousRows = new Map(previous.snapshot.rows.map((row) => [row.legend.legendId, row]))
      const expectedDeltaIds = entry.snapshot.rows.flatMap((row) => {
        const previousRow = previousRows.get(row.legend.legendId)
        return row.eligibility.status === 'eligible' &&
          previousRow?.eligibility.status === 'eligible' &&
          row.medianRating !== null &&
          previousRow.medianRating !== null &&
          row.pickShare.basisPoints !== null &&
          previousRow.pickShare.basisPoints !== null &&
          row.adoption.basisPoints !== null &&
          previousRow.adoption.basisPoints !== null &&
          row.winRate.basisPoints !== null &&
          previousRow.winRate.basisPoints !== null
          ? [String(row.legend.legendId)]
          : []
      })
      validateExactHistoryDeltaKeys(
        expectedDeltaIds,
        entry.comparisonToPrevious.deltas.map(({ legend }) => String(legend.legendId)),
        context,
        ['entries', index, 'comparisonToPrevious', 'deltas'],
      )
      for (let deltaIndex = 0; deltaIndex < entry.comparisonToPrevious.deltas.length; deltaIndex += 1) {
        const delta = entry.comparisonToPrevious.deltas[deltaIndex]
        if (!delta) continue
        const currentRow = entry.snapshot.rows.find(({ legend }) => legend.legendId === delta.legend.legendId)
        const previousRow = previousRows.get(delta.legend.legendId)
        if (
          currentRow?.eligibility.status !== 'eligible' ||
          previousRow?.eligibility.status !== 'eligible' ||
          currentRow.medianRating === null ||
          previousRow.medianRating === null ||
          currentRow.pickShare.basisPoints === null ||
          previousRow.pickShare.basisPoints === null ||
          currentRow.adoption.basisPoints === null ||
          previousRow.adoption.basisPoints === null ||
          currentRow.winRate.basisPoints === null ||
          previousRow.winRate.basisPoints === null
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Legend history deltas require stored eligibility and complete metrics in both snapshots',
            path: ['entries', index, 'comparisonToPrevious', 'deltas', deltaIndex],
          })
          continue
        }
        if (
          delta.legend.name !== currentRow.legend.name ||
          delta.legend.slug !== currentRow.legend.slug ||
          delta.pickShare.changeBasisPoints !== currentRow.pickShare.basisPoints - previousRow.pickShare.basisPoints ||
          delta.adoption.changeBasisPoints !== currentRow.adoption.basisPoints - previousRow.adoption.basisPoints ||
          delta.winRate.changeBasisPoints !== currentRow.winRate.basisPoints - previousRow.winRate.basisPoints ||
          delta.medianRating.change !== currentRow.medianRating - previousRow.medianRating
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Legend history deltas must reproduce adjacent immutable rows',
            path: ['entries', index, 'comparisonToPrevious', 'deltas', deltaIndex],
          })
        }
      }
    }
  })

const legendMetaHistoryUnavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: z.literal('not_yet_published'),
    filter: filterSchema,
  })
  .strict()

export const legendMetaHistoryOutputSchema = z.union([
  legendMetaHistoryAvailableSchema,
  legendMetaHistoryUnavailableSchema,
])

export type LegendMetaInput = z.infer<typeof legendMetaInputSchema>
export type LegendMetaOutput = z.infer<typeof legendMetaOutputSchema>
export type LegendMetaHistoryOutput = z.infer<typeof legendMetaHistoryOutputSchema>

export function parseLegendMetaOutput(value: unknown): LegendMetaOutput {
  return legendMetaOutputSchema.parse(value)
}

export function parseLegendMetaHistoryOutput(value: unknown): LegendMetaHistoryOutput {
  return legendMetaHistoryOutputSchema.parse(value)
}
