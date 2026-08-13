export const STATISTICS_HISTORY_LIMIT = 8

export type StatisticsHistoryDirection = 'increase' | 'decrease' | 'unchanged'

export type StatisticsHistoryScope = {
  region: string
  bracket: string
}

export type StatisticsHistorySeason =
  | { applicability: 'required'; identity: string | null }
  | { applicability: 'not-applicable' }

export type StatisticsSnapshotCompatibility = {
  season: StatisticsHistorySeason
  cohortMethodologyVersion: string
  metricMethodologyVersion: string
  scope: StatisticsHistoryScope
}

export type StatisticsHistoryCompatibilityReason =
  | {
      code: 'season_identity_unavailable'
      explanation: 'Adjacent Legend snapshots need the same non-null authoritative season identity.'
    }
  | {
      code: 'season_mismatch'
      explanation: 'The authoritative season identity changed between adjacent snapshots.'
    }
  | {
      code: 'cohort_methodology_mismatch'
      explanation: 'The cohort methodology changed between adjacent snapshots.'
    }
  | {
      code: 'metric_methodology_mismatch'
      explanation: 'The product metric methodology changed between adjacent snapshots.'
    }
  | {
      code: 'scope_mismatch'
      explanation: 'The region or bracket scope changed between adjacent snapshots.'
    }

export type StatisticsHistoryCompatibility =
  | { status: 'compatible' }
  | { status: 'incompatible'; reasons: StatisticsHistoryCompatibilityReason[] }

const compatibilityReasons = {
  season_identity_unavailable: {
    code: 'season_identity_unavailable',
    explanation: 'Adjacent Legend snapshots need the same non-null authoritative season identity.',
  },
  season_mismatch: {
    code: 'season_mismatch',
    explanation: 'The authoritative season identity changed between adjacent snapshots.',
  },
  cohort_methodology_mismatch: {
    code: 'cohort_methodology_mismatch',
    explanation: 'The cohort methodology changed between adjacent snapshots.',
  },
  metric_methodology_mismatch: {
    code: 'metric_methodology_mismatch',
    explanation: 'The product metric methodology changed between adjacent snapshots.',
  },
  scope_mismatch: {
    code: 'scope_mismatch',
    explanation: 'The region or bracket scope changed between adjacent snapshots.',
  },
} as const satisfies Record<string, StatisticsHistoryCompatibilityReason>

export function classifyAdjacentSnapshots(
  newer: StatisticsSnapshotCompatibility,
  older: StatisticsSnapshotCompatibility,
): StatisticsHistoryCompatibility {
  const reasons: StatisticsHistoryCompatibilityReason[] = []

  if (newer.season.applicability !== older.season.applicability) {
    reasons.push(compatibilityReasons.season_mismatch)
  } else if (newer.season.applicability === 'required' && older.season.applicability === 'required') {
    if (newer.season.identity === null || older.season.identity === null) {
      reasons.push(compatibilityReasons.season_identity_unavailable)
    } else if (newer.season.identity !== older.season.identity) {
      reasons.push(compatibilityReasons.season_mismatch)
    }
  }
  if (newer.cohortMethodologyVersion !== older.cohortMethodologyVersion) {
    reasons.push(compatibilityReasons.cohort_methodology_mismatch)
  }
  if (newer.metricMethodologyVersion !== older.metricMethodologyVersion) {
    reasons.push(compatibilityReasons.metric_methodology_mismatch)
  }
  if (newer.scope.region !== older.scope.region || newer.scope.bracket !== older.scope.bracket) {
    reasons.push(compatibilityReasons.scope_mismatch)
  }

  return reasons.length === 0 ? { status: 'compatible' } : { status: 'incompatible', reasons }
}

type HistorySnapshot = {
  snapshotId: string
  publishedAt: string
  sequence?: { at: string; id: string }
  compatibility: StatisticsSnapshotCompatibility
}

export type StatisticsHistoryComparison<Delta> =
  | { status: 'available'; previousSnapshotId: string; deltas: Delta[] }
  | {
      status: 'incompatible'
      previousSnapshotId: string
      reasons: StatisticsHistoryCompatibilityReason[]
    }

export type StatisticsHistoryEntry<Snapshot, Delta> = {
  snapshot: Snapshot
  comparisonToPrevious: StatisticsHistoryComparison<Delta> | null
}

function chronologicalDescending<Snapshot extends HistorySnapshot>(snapshots: readonly Snapshot[]): Snapshot[] {
  return [...snapshots].sort((left, right) => {
    const leftSequence = left.sequence ?? { at: left.publishedAt, id: left.snapshotId }
    const rightSequence = right.sequence ?? { at: right.publishedAt, id: right.snapshotId }
    const timeDifference = Date.parse(rightSequence.at) - Date.parse(leftSequence.at)
    return timeDifference || rightSequence.id.localeCompare(leftSequence.id)
  })
}

function buildHistory<Snapshot extends HistorySnapshot, Delta>(
  snapshots: readonly Snapshot[],
  deltas: (newer: Snapshot, older: Snapshot) => Delta[],
): StatisticsHistoryEntry<Snapshot, Delta>[] {
  const entries = chronologicalDescending(snapshots)
    .slice(0, STATISTICS_HISTORY_LIMIT)
    .map((snapshot) => ({ snapshot, comparisonToPrevious: null })) as StatisticsHistoryEntry<Snapshot, Delta>[]

  for (let index = 0; index < entries.length - 1; index += 1) {
    const current = entries[index]
    const previous = entries[index + 1]
    if (!current || !previous) break
    const compatibility = classifyAdjacentSnapshots(current.snapshot.compatibility, previous.snapshot.compatibility)
    if (compatibility.status === 'incompatible') {
      current.comparisonToPrevious = {
        ...compatibility,
        previousSnapshotId: previous.snapshot.snapshotId,
      }
      return entries.slice(0, index + 2)
    }
    current.comparisonToPrevious = {
      status: 'available',
      previousSnapshotId: previous.snapshot.snapshotId,
      deltas: deltas(current.snapshot, previous.snapshot),
    }
  }

  return entries
}

function direction(change: number | bigint): StatisticsHistoryDirection {
  if (change > 0) return 'increase'
  if (change < 0) return 'decrease'
  return 'unchanged'
}

export type LegendMetaHistoryRow = {
  legend: { legendId: number; name: string; slug: string }
  eligible: boolean
  rank: number | null
  medianRating: number | null
  pickShareBasisPoints: number | null
  adoptionBasisPoints: number | null
  winRateBasisPoints: number | null
}

export type LegendMetaHistorySnapshot = HistorySnapshot & {
  observationWindow: { startsAt: string; endsAt: string }
  rows: LegendMetaHistoryRow[]
}

export type LegendMetaHistoryDelta = {
  legend: LegendMetaHistoryRow['legend']
  pickShare: { changeBasisPoints: number; direction: StatisticsHistoryDirection }
  adoption: { changeBasisPoints: number; direction: StatisticsHistoryDirection }
  winRate: { changeBasisPoints: number; direction: StatisticsHistoryDirection }
  medianRating: { change: number; direction: StatisticsHistoryDirection }
}

function legendMetaDeltas(
  newer: LegendMetaHistorySnapshot,
  older: LegendMetaHistorySnapshot,
): LegendMetaHistoryDelta[] {
  const olderRows = new Map(older.rows.map((row) => [row.legend.legendId, row]))
  return newer.rows.flatMap((row): LegendMetaHistoryDelta[] => {
    const previous = olderRows.get(row.legend.legendId)
    if (
      !row.eligible ||
      !previous?.eligible ||
      row.medianRating === null ||
      previous.medianRating === null ||
      row.pickShareBasisPoints === null ||
      previous.pickShareBasisPoints === null ||
      row.adoptionBasisPoints === null ||
      previous.adoptionBasisPoints === null ||
      row.winRateBasisPoints === null ||
      previous.winRateBasisPoints === null
    ) {
      return []
    }
    const pickShare = row.pickShareBasisPoints - previous.pickShareBasisPoints
    const adoption = row.adoptionBasisPoints - previous.adoptionBasisPoints
    const winRate = row.winRateBasisPoints - previous.winRateBasisPoints
    const medianRating = row.medianRating - previous.medianRating
    return [
      {
        legend: row.legend,
        pickShare: { changeBasisPoints: pickShare, direction: direction(pickShare) },
        adoption: { changeBasisPoints: adoption, direction: direction(adoption) },
        winRate: { changeBasisPoints: winRate, direction: direction(winRate) },
        medianRating: { change: medianRating, direction: direction(medianRating) },
      },
    ]
  })
}

export function buildLegendMetaHistory<Snapshot extends LegendMetaHistorySnapshot>(
  snapshots: readonly Snapshot[],
): StatisticsHistoryEntry<Snapshot, LegendMetaHistoryDelta>[] {
  return buildHistory(snapshots, legendMetaDeltas)
}

export type CareerWeaponHistoryRatio = { numerator: string; denominator: string }

export type CareerWeaponHistoryRow = {
  weapon: string
  eligible: boolean
  prevalence: CareerWeaponHistoryRatio | null
  heldTimeShare: CareerWeaponHistoryRatio | null
  medianDamagePerMinute: CareerWeaponHistoryRatio | null
  medianKosPerHour: CareerWeaponHistoryRatio | null
}

export type CareerWeaponHistorySnapshot = HistorySnapshot & {
  observationWindow: { startsAt: string; endsAt: string }
  rows: CareerWeaponHistoryRow[]
}

export type SignedExactRatio = { numerator: string; denominator: string }

export type CareerWeaponHistoryDelta = {
  weapon: string
  prevalence: { changeBasisPoints: number; direction: StatisticsHistoryDirection }
  heldTimeShare: { changeBasisPoints: number; direction: StatisticsHistoryDirection }
  medianDamagePerMinute: { change: SignedExactRatio; direction: StatisticsHistoryDirection }
  medianKosPerHour: { change: SignedExactRatio; direction: StatisticsHistoryDirection }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function exactDifference(newer: CareerWeaponHistoryRatio, older: CareerWeaponHistoryRatio): SignedExactRatio {
  const newerNumerator = BigInt(newer.numerator)
  const newerDenominator = BigInt(newer.denominator)
  const olderNumerator = BigInt(older.numerator)
  const olderDenominator = BigInt(older.denominator)
  const numerator = newerNumerator * olderDenominator - olderNumerator * newerDenominator
  const denominator = newerDenominator * olderDenominator
  if (numerator === 0n) return { numerator: '0', denominator: '1' }
  const divisor = greatestCommonDivisor(numerator, denominator)
  return { numerator: String(numerator / divisor), denominator: String(denominator / divisor) }
}

function roundedBasisPoints(ratio: CareerWeaponHistoryRatio): number {
  const numerator = BigInt(ratio.numerator)
  const denominator = BigInt(ratio.denominator)
  return Number((numerator * 20_000n + denominator) / (denominator * 2n))
}

function ratioDirection(ratio: SignedExactRatio): StatisticsHistoryDirection {
  return direction(BigInt(ratio.numerator))
}

function careerWeaponDeltas(
  newer: CareerWeaponHistorySnapshot,
  older: CareerWeaponHistorySnapshot,
): CareerWeaponHistoryDelta[] {
  const olderRows = new Map(older.rows.map((row) => [row.weapon, row]))
  return newer.rows.flatMap((row): CareerWeaponHistoryDelta[] => {
    const previous = olderRows.get(row.weapon)
    if (
      !row.eligible ||
      !previous?.eligible ||
      !row.prevalence ||
      !previous.prevalence ||
      !row.heldTimeShare ||
      !previous.heldTimeShare ||
      !row.medianDamagePerMinute ||
      !previous.medianDamagePerMinute ||
      !row.medianKosPerHour ||
      !previous.medianKosPerHour
    ) {
      return []
    }
    const prevalence = roundedBasisPoints(row.prevalence) - roundedBasisPoints(previous.prevalence)
    const heldTimeShare = roundedBasisPoints(row.heldTimeShare) - roundedBasisPoints(previous.heldTimeShare)
    const damage = exactDifference(row.medianDamagePerMinute, previous.medianDamagePerMinute)
    const kos = exactDifference(row.medianKosPerHour, previous.medianKosPerHour)
    return [
      {
        weapon: row.weapon,
        prevalence: { changeBasisPoints: prevalence, direction: direction(prevalence) },
        heldTimeShare: { changeBasisPoints: heldTimeShare, direction: direction(heldTimeShare) },
        medianDamagePerMinute: { change: damage, direction: ratioDirection(damage) },
        medianKosPerHour: { change: kos, direction: ratioDirection(kos) },
      },
    ]
  })
}

export function buildCareerWeaponUsageHistory<Snapshot extends CareerWeaponHistorySnapshot>(
  snapshots: readonly Snapshot[],
): StatisticsHistoryEntry<Snapshot, CareerWeaponHistoryDelta>[] {
  return buildHistory(snapshots, careerWeaponDeltas)
}
