import { z } from './zod'

export const statisticsHistoryDirectionSchema = z.enum(['increase', 'decrease', 'unchanged'])

export const statisticsHistoryCompatibilityReasonSchema = z.union([
  z
    .object({
      code: z.literal('season_identity_unavailable'),
      explanation: z.literal('Adjacent Legend snapshots need the same non-null authoritative season identity.'),
    })
    .strict(),
  z
    .object({
      code: z.literal('season_mismatch'),
      explanation: z.literal('The authoritative season identity changed between adjacent snapshots.'),
    })
    .strict(),
  z
    .object({
      code: z.literal('cohort_methodology_mismatch'),
      explanation: z.literal('The cohort methodology changed between adjacent snapshots.'),
    })
    .strict(),
  z
    .object({
      code: z.literal('metric_methodology_mismatch'),
      explanation: z.literal('The product metric methodology changed between adjacent snapshots.'),
    })
    .strict(),
  z
    .object({
      code: z.literal('scope_mismatch'),
      explanation: z.literal('The region or bracket scope changed between adjacent snapshots.'),
    })
    .strict(),
])

export type StatisticsHistoryCompatibilityReasonContract = z.infer<typeof statisticsHistoryCompatibilityReasonSchema>

export type StatisticsHistoryContractSnapshot = {
  snapshotId: string
  cohortMethodologyVersion: string
  methodologyVersion: string
  season: { identity: string | null } | null
  scope: { region: string; bracket: string }
}

export function expectedCompatibilityReasonCodes(
  newer: StatisticsHistoryContractSnapshot,
  older: StatisticsHistoryContractSnapshot,
): StatisticsHistoryCompatibilityReasonContract['code'][] {
  const reasons: StatisticsHistoryCompatibilityReasonContract['code'][] = []
  if (newer.season !== null || older.season !== null) {
    if (newer.season === null || older.season === null) {
      reasons.push('season_mismatch')
    } else if (newer.season.identity === null || older.season.identity === null) {
      reasons.push('season_identity_unavailable')
    } else if (newer.season.identity !== older.season.identity) {
      reasons.push('season_mismatch')
    }
  }
  if (newer.cohortMethodologyVersion !== older.cohortMethodologyVersion) {
    reasons.push('cohort_methodology_mismatch')
  }
  if (newer.methodologyVersion !== older.methodologyVersion) {
    reasons.push('metric_methodology_mismatch')
  }
  if (newer.scope.region !== older.scope.region || newer.scope.bracket !== older.scope.bracket) {
    reasons.push('scope_mismatch')
  }
  return reasons
}

export function directionFor(change: number | bigint): 'increase' | 'decrease' | 'unchanged' {
  if (change > 0) return 'increase'
  if (change < 0) return 'decrease'
  return 'unchanged'
}

export function validateExactHistoryDeltaKeys(
  expectedKeys: readonly string[],
  actualKeys: readonly string[],
  context: {
    addIssue(issue: { code: 'custom'; message: string; path?: PropertyKey[] }): void
  },
  path: PropertyKey[],
): void {
  const expected = new Set(expectedKeys)
  const actual = new Set(actualKeys)
  if (
    expected.size !== expectedKeys.length ||
    actual.size !== actualKeys.length ||
    expected.size !== actual.size ||
    [...expected].some((key) => !actual.has(key))
  ) {
    context.addIssue({
      code: 'custom',
      message: 'history deltas must contain each eligible adjacent row exactly once',
      path,
    })
  }
}

export function validateHistoryStructure(
  entries: readonly {
    snapshot: StatisticsHistoryContractSnapshot
    comparisonToPrevious: null | {
      status: 'available' | 'incompatible'
      previousSnapshotId: string
      reasons?: readonly StatisticsHistoryCompatibilityReasonContract[]
    }
  }[],
  context: {
    addIssue(issue: { code: 'custom'; message: string; path?: PropertyKey[] }): void
  },
): void {
  if (new Set(entries.map(({ snapshot }) => snapshot.snapshotId)).size !== entries.length) {
    context.addIssue({ code: 'custom', message: 'history snapshot IDs must be unique', path: ['entries'] })
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const previous = entries[index + 1]
    if (!entry) continue
    if (!previous) {
      if (entry.comparisonToPrevious !== null) {
        context.addIssue({
          code: 'custom',
          message: 'the oldest history snapshot cannot compare to an absent predecessor',
          path: ['entries', index, 'comparisonToPrevious'],
        })
      }
      continue
    }
    if (!entry.comparisonToPrevious) {
      context.addIssue({
        code: 'custom',
        message: 'every adjacent history pair requires a comparison result',
        path: ['entries', index, 'comparisonToPrevious'],
      })
      continue
    }
    if (entry.comparisonToPrevious.previousSnapshotId !== previous.snapshot.snapshotId) {
      context.addIssue({
        code: 'custom',
        message: 'history comparison must identify its adjacent predecessor',
        path: ['entries', index, 'comparisonToPrevious', 'previousSnapshotId'],
      })
    }
    const expectedReasons = expectedCompatibilityReasonCodes(entry.snapshot, previous.snapshot)
    if (entry.comparisonToPrevious.status === 'available') {
      if (expectedReasons.length > 0) {
        context.addIssue({
          code: 'custom',
          message: 'incompatible adjacent snapshots cannot expose deltas',
          path: ['entries', index, 'comparisonToPrevious'],
        })
      }
    } else {
      if (index !== entries.length - 2) {
        context.addIssue({
          code: 'custom',
          message: 'history must stop immediately after its first incompatible edge',
          path: ['entries', index, 'comparisonToPrevious'],
        })
      }
      const actualReasons = entry.comparisonToPrevious.reasons?.map(({ code }) => code) ?? []
      if (
        actualReasons.length !== expectedReasons.length ||
        actualReasons.some((reason, reasonIndex) => reason !== expectedReasons[reasonIndex])
      ) {
        context.addIssue({
          code: 'custom',
          message: 'history incompatibility reasons must reproduce adjacent snapshot metadata in stable order',
          path: ['entries', index, 'comparisonToPrevious', 'reasons'],
        })
      }
    }
  }
}
