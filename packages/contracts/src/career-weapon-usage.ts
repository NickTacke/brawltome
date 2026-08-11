import { leaderboardRegions } from './leaderboard'
import { legendMetaBrackets } from './statistics'
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

export type CareerWeaponUsageInputContract = z.infer<typeof careerWeaponUsageInputSchema>
export type CareerWeaponUsageOutputContract = z.infer<typeof careerWeaponUsageOutputSchema>
export type CareerWeaponUsageRowContract = z.infer<typeof careerWeaponUsageRowSchema>
export type CareerWeaponExactRatioContract = z.infer<typeof careerWeaponExactRatioSchema>

export function parseCareerWeaponUsageOutput(value: unknown): CareerWeaponUsageOutputContract {
  return careerWeaponUsageOutputSchema.parse(value)
}
