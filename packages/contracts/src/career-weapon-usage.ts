import { leaderboardRegions } from './leaderboard'
import { legendMetaBrackets } from './statistics'
import {
  directionFor,
  statisticsHistoryCompatibilityReasonSchema,
  statisticsHistoryDirectionSchema,
  validateExactHistoryDeltaKeys,
  validateHistoryStructure,
} from './statistics-history'
import { z } from './zod'

export const careerWeaponUsageMethodologyVersion = 'career-weapon-usage-v1' as const
export const careerWeaponUsageRegionScopes = ['all', ...leaderboardRegions] as const
export const careerWeaponUsageBracketScopes = legendMetaBrackets

export const careerWeaponUsageRegionSchema = z.enum(careerWeaponUsageRegionScopes)
export const careerWeaponUsageBracketSchema = z.enum(careerWeaponUsageBracketScopes)

export const careerWeaponUsageInputSchema = z
  .object({
    region: careerWeaponUsageRegionSchema,
    bracket: careerWeaponUsageBracketSchema,
  })
  .strict()

const utcDateTimeSchema = z.iso
  .datetime({ offset: false })
  .regex(/Z$/, 'date-time must use the UTC Z suffix')
  .meta({ format: 'date-time' })
const nonnegativeInt32 = z.int().min(0).max(2_147_483_647).meta({ format: 'int32' })
const nonnegativeIntegerString = z.string().regex(/^(0|[1-9][0-9]*)$/, 'must be a non-negative integer string')
const positiveIntegerString = z.string().regex(/^[1-9][0-9]*$/, 'must be a positive integer string')

export const careerWeaponExactRatioSchema = z
  .object({
    numerator: nonnegativeIntegerString,
    denominator: positiveIntegerString,
  })
  .strict()

const comparisonReasonSchema = z.enum(['contributors-below-30', 'aggregate-held-time-below-30-hours'])
const comparisonSchema = z.discriminatedUnion('eligible', [
  z.object({ eligible: z.literal(true), reasons: z.tuple([]) }).strict(),
  z.object({ eligible: z.literal(false), reasons: z.array(comparisonReasonSchema).min(1).max(2) }).strict(),
])

export const careerWeaponUsageRowSchema = z
  .object({
    weapon: z.string().min(1).max(100),
    observedPlayers: nonnegativeInt32,
    prevalence: careerWeaponExactRatioSchema.nullable(),
    heldTimeSeconds: nonnegativeIntegerString,
    heldTimeShare: careerWeaponExactRatioSchema.nullable(),
    contributorCount: nonnegativeInt32,
    qualifyingHeldSeconds: nonnegativeIntegerString,
    medianDamagePerMinute: careerWeaponExactRatioSchema.nullable(),
    medianKosPerHour: careerWeaponExactRatioSchema.nullable(),
    comparison: comparisonSchema,
  })
  .strict()
  .superRefine((row, context) => {
    if (row.contributorCount > row.observedPlayers) {
      context.addIssue({ code: 'custom', message: 'contributors must not exceed observed players' })
    }
    const hasBothRates = row.medianDamagePerMinute !== null && row.medianKosPerHour !== null
    if (row.comparison.eligible !== hasBothRates) {
      context.addIssue({ code: 'custom', message: 'comparison eligibility must match rate availability' })
    }
  })

const filtersSchema = careerWeaponUsageInputSchema
const observationWindowSchema = z
  .object({
    startsAt: utcDateTimeSchema,
    endsAt: utcDateTimeSchema,
  })
  .strict()
  .refine(({ startsAt, endsAt }) => new Date(endsAt).getTime() > new Date(startsAt).getTime(), {
    message: 'observation window end must follow its start',
  })
const staleReasonSchema = z.enum(['newer_publication_rejected', 'weekly_publication_overdue'])

const availableFields = {
  snapshotId: z.uuid(),
  generationId: z.uuid(),
  cohortMethodologyVersion: z.string().min(1).max(200),
  methodologyVersion: z.literal(careerWeaponUsageMethodologyVersion),
  observationWindow: observationWindowSchema,
  publishedAt: utcDateTimeSchema,
  expectedNextPublicationAt: utcDateTimeSchema,
  filters: filtersSchema,
  selectedPlayers: nonnegativeInt32,
  successfulObservations: nonnegativeInt32,
  coverage: careerWeaponExactRatioSchema.nullable(),
  totalHeldSeconds: nonnegativeIntegerString,
  rows: z.array(careerWeaponUsageRowSchema).max(100),
} as const

function availableSchema<Status extends 'fresh' | 'stale'>(status: Status) {
  return z
    .object({
      status: z.literal(status),
      ...availableFields,
      staleReasons: status === 'fresh' ? z.array(staleReasonSchema).max(0) : z.array(staleReasonSchema).min(1).max(2),
    })
    .strict()
    .superRefine((snapshot, context) => {
      if (snapshot.successfulObservations > snapshot.selectedPlayers) {
        context.addIssue({ code: 'custom', message: 'successful observations must not exceed selected players' })
      }
      if (snapshot.rows.some((row) => row.observedPlayers > snapshot.successfulObservations)) {
        context.addIssue({ code: 'custom', message: 'weapon observations must not exceed successful observations' })
      }
      if (new Set(snapshot.rows.map(({ weapon }) => weapon)).size !== snapshot.rows.length) {
        context.addIssue({ code: 'custom', message: 'weapon rows must be unique' })
      }
    })
}

const unavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: z.literal('not_yet_published'),
    filters: filtersSchema,
  })
  .strict()

export const careerWeaponUsageOutputSchema = z.union([
  availableSchema('fresh'),
  availableSchema('stale'),
  unavailableSchema,
])

function exactRatioMatches(
  ratio: { numerator: string; denominator: string } | null,
  numerator: bigint,
  denominator: bigint,
): boolean {
  if (denominator === 0n) return ratio === null
  if (!ratio) return false
  return BigInt(ratio.numerator) * denominator === numerator * BigInt(ratio.denominator)
}

const careerWeaponHistorySnapshotSchema = z
  .object({
    snapshotId: z.uuid(),
    generationId: z.uuid(),
    cohortMethodologyVersion: z.string().min(1).max(200),
    methodologyVersion: z.string().min(1).max(200),
    observationWindow: observationWindowSchema,
    publishedAt: utcDateTimeSchema,
    scope: filtersSchema,
    selectedPlayers: nonnegativeInt32,
    successfulObservations: nonnegativeInt32,
    coverage: careerWeaponExactRatioSchema.nullable(),
    totalHeldSeconds: nonnegativeIntegerString,
    rows: z.array(careerWeaponUsageRowSchema).max(100),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.successfulObservations > snapshot.selectedPlayers) {
      context.addIssue({ code: 'custom', message: 'successful observations must not exceed selected players' })
    }
    if (
      !exactRatioMatches(snapshot.coverage, BigInt(snapshot.successfulObservations), BigInt(snapshot.selectedPlayers))
    ) {
      context.addIssue({ code: 'custom', message: 'coverage must reproduce successful and selected players' })
    }
    if (snapshot.rows.some((row) => row.observedPlayers > snapshot.successfulObservations)) {
      context.addIssue({ code: 'custom', message: 'weapon observations must not exceed successful observations' })
    }
    if (new Set(snapshot.rows.map(({ weapon }) => weapon)).size !== snapshot.rows.length) {
      context.addIssue({ code: 'custom', message: 'weapon rows must be unique' })
    }
    const totalHeldSeconds = BigInt(snapshot.totalHeldSeconds)
    if (snapshot.rows.reduce((total, row) => total + BigInt(row.heldTimeSeconds), 0n) !== totalHeldSeconds) {
      context.addIssue({ code: 'custom', message: 'weapon rows must reproduce total held seconds' })
    }
    for (const row of snapshot.rows) {
      if (!exactRatioMatches(row.prevalence, BigInt(row.observedPlayers), BigInt(snapshot.successfulObservations))) {
        context.addIssue({ code: 'custom', message: 'prevalence must reproduce weapon and successful observations' })
      }
      if (!exactRatioMatches(row.heldTimeShare, BigInt(row.heldTimeSeconds), totalHeldSeconds)) {
        context.addIssue({ code: 'custom', message: 'held-time share must reproduce weapon and total held seconds' })
      }
    }
  })

const signedIntegerString = z.string().regex(/^-?(0|[1-9][0-9]*)$/, 'must be a signed integer string')
const signedExactRatioSchema = z
  .object({ numerator: signedIntegerString, denominator: positiveIntegerString })
  .strict()
  .superRefine((ratio, context) => {
    const numerator = BigInt(ratio.numerator)
    const denominator = BigInt(ratio.denominator)
    const absoluteNumerator = numerator < 0n ? -numerator : numerator
    let left = absoluteNumerator
    let right = denominator
    while (right !== 0n) [left, right] = [right, left % right]
    if ((numerator === 0n && denominator !== 1n) || (numerator !== 0n && left !== 1n)) {
      context.addIssue({ code: 'custom', message: 'signed exact ratio must use normalized terms' })
    }
  })

function directedBasisPointChangeSchema() {
  return z
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
}

function directedExactChangeSchema() {
  return z
    .object({ change: signedExactRatioSchema, direction: statisticsHistoryDirectionSchema })
    .strict()
    .superRefine((value, context) => {
      if (value.direction !== directionFor(BigInt(value.change.numerator))) {
        context.addIssue({ code: 'custom', message: 'history direction must reproduce the signed change' })
      }
    })
}

const careerWeaponHistoryDeltaSchema = z
  .object({
    weapon: z.string().min(1).max(100),
    prevalence: directedBasisPointChangeSchema(),
    heldTimeShare: directedBasisPointChangeSchema(),
    medianDamagePerMinute: directedExactChangeSchema(),
    medianKosPerHour: directedExactChangeSchema(),
  })
  .strict()

const careerWeaponHistoryComparisonSchema = z.union([
  z
    .object({
      status: z.literal('available'),
      previousSnapshotId: z.uuid(),
      deltas: z.array(careerWeaponHistoryDeltaSchema).max(100),
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

function roundedBasisPoints(ratio: { numerator: string; denominator: string }): number {
  const numerator = BigInt(ratio.numerator)
  const denominator = BigInt(ratio.denominator)
  return Number((numerator * 20_000n + denominator) / (denominator * 2n))
}

function normalizedDifference(
  newer: { numerator: string; denominator: string },
  older: { numerator: string; denominator: string },
): { numerator: string; denominator: string } {
  const numerator =
    BigInt(newer.numerator) * BigInt(older.denominator) - BigInt(older.numerator) * BigInt(newer.denominator)
  const denominator = BigInt(newer.denominator) * BigInt(older.denominator)
  if (numerator === 0n) return { numerator: '0', denominator: '1' }
  let left = numerator < 0n ? -numerator : numerator
  let right = denominator
  while (right !== 0n) [left, right] = [right, left % right]
  return { numerator: String(numerator / left), denominator: String(denominator / left) }
}

const careerWeaponHistoryAvailableSchema = z
  .object({
    status: z.literal('available'),
    filters: filtersSchema,
    entries: z
      .array(
        z
          .object({
            snapshot: careerWeaponHistorySnapshotSchema,
            comparisonToPrevious: careerWeaponHistoryComparisonSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .superRefine((history, context) => {
    validateHistoryStructure(
      history.entries.map((entry) => ({
        ...entry,
        snapshot: { ...entry.snapshot, season: null },
      })),
      context,
    )
    for (let index = 0; index < history.entries.length; index += 1) {
      const entry = history.entries[index]
      if (!entry) continue
      if (
        entry.snapshot.scope.region !== history.filters.region ||
        entry.snapshot.scope.bracket !== history.filters.bracket
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Career history snapshot scope must match requested filters',
          path: ['entries', index, 'snapshot', 'scope'],
        })
      }
      const previous = history.entries[index + 1]
      if (!previous || entry.comparisonToPrevious?.status !== 'available') continue
      const previousRows = new Map(previous.snapshot.rows.map((row) => [row.weapon, row]))
      const expectedDeltaWeapons = entry.snapshot.rows.flatMap((row) => {
        const previousRow = previousRows.get(row.weapon)
        return row.comparison.eligible &&
          previousRow?.comparison.eligible &&
          row.prevalence !== null &&
          previousRow.prevalence !== null &&
          row.heldTimeShare !== null &&
          previousRow.heldTimeShare !== null &&
          row.medianDamagePerMinute !== null &&
          previousRow.medianDamagePerMinute !== null &&
          row.medianKosPerHour !== null &&
          previousRow.medianKosPerHour !== null
          ? [row.weapon]
          : []
      })
      validateExactHistoryDeltaKeys(
        expectedDeltaWeapons,
        entry.comparisonToPrevious.deltas.map(({ weapon }) => weapon),
        context,
        ['entries', index, 'comparisonToPrevious', 'deltas'],
      )
      for (let deltaIndex = 0; deltaIndex < entry.comparisonToPrevious.deltas.length; deltaIndex += 1) {
        const delta = entry.comparisonToPrevious.deltas[deltaIndex]
        if (!delta) continue
        const currentRow = entry.snapshot.rows.find(({ weapon }) => weapon === delta.weapon)
        const previousRow = previousRows.get(delta.weapon)
        if (
          currentRow?.comparison.eligible !== true ||
          previousRow?.comparison.eligible !== true ||
          !currentRow.prevalence ||
          !previousRow.prevalence ||
          !currentRow.heldTimeShare ||
          !previousRow.heldTimeShare ||
          !currentRow.medianDamagePerMinute ||
          !previousRow.medianDamagePerMinute ||
          !currentRow.medianKosPerHour ||
          !previousRow.medianKosPerHour
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Career history deltas require stored eligibility and complete metrics in both snapshots',
            path: ['entries', index, 'comparisonToPrevious', 'deltas', deltaIndex],
          })
          continue
        }
        const damage = normalizedDifference(currentRow.medianDamagePerMinute, previousRow.medianDamagePerMinute)
        const kos = normalizedDifference(currentRow.medianKosPerHour, previousRow.medianKosPerHour)
        if (
          delta.prevalence.changeBasisPoints !==
            roundedBasisPoints(currentRow.prevalence) - roundedBasisPoints(previousRow.prevalence) ||
          delta.heldTimeShare.changeBasisPoints !==
            roundedBasisPoints(currentRow.heldTimeShare) - roundedBasisPoints(previousRow.heldTimeShare) ||
          delta.medianDamagePerMinute.change.numerator !== damage.numerator ||
          delta.medianDamagePerMinute.change.denominator !== damage.denominator ||
          delta.medianKosPerHour.change.numerator !== kos.numerator ||
          delta.medianKosPerHour.change.denominator !== kos.denominator
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Career history deltas must reproduce adjacent immutable rows',
            path: ['entries', index, 'comparisonToPrevious', 'deltas', deltaIndex],
          })
        }
      }
    }
  })

const careerWeaponHistoryUnavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: z.literal('not_yet_published'),
    filters: filtersSchema,
  })
  .strict()

export const careerWeaponUsageHistoryOutputSchema = z.union([
  careerWeaponHistoryAvailableSchema,
  careerWeaponHistoryUnavailableSchema,
])

export type CareerWeaponUsageInputContract = z.infer<typeof careerWeaponUsageInputSchema>
export type CareerWeaponUsageOutputContract = z.infer<typeof careerWeaponUsageOutputSchema>
export type CareerWeaponUsageHistoryOutputContract = z.infer<typeof careerWeaponUsageHistoryOutputSchema>
export type CareerWeaponUsageRowContract = z.infer<typeof careerWeaponUsageRowSchema>
export type CareerWeaponExactRatioContract = z.infer<typeof careerWeaponExactRatioSchema>

export function parseCareerWeaponUsageOutput(value: unknown): CareerWeaponUsageOutputContract {
  return careerWeaponUsageOutputSchema.parse(value)
}

export function parseCareerWeaponUsageHistoryOutput(value: unknown): CareerWeaponUsageHistoryOutputContract {
  return careerWeaponUsageHistoryOutputSchema.parse(value)
}
