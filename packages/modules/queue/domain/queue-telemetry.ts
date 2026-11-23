import {
  type DeadLetterReason,
  leaderboardOperationKinds,
  type OperationCohort,
  type OperationLease,
  type OperationsTelemetrySnapshot,
  operationCohorts,
  statisticsCollectionKinds,
  type WorkClass,
  workClasses,
} from '../model'

type OperationKind = OperationLease['kind']

export type TelemetryReadings = {
  observedAt: Date
  oldestPending: { workClass: WorkClass; ageMs: number }[]
  deadLetters: { workClass: WorkClass; kind: string; reason: DeadLetterReason; cohort: string; count: number }[]
  scheduleLateness: { kind: string; latenessMs: number }[]
}

const allOperationKinds: OperationKind[] = [
  'proof',
  'primary-player-verification',
  'interactive-player-refresh',
  'clan-refresh',
  'clan-weekly-snapshot',
  'player-discovery-projection',
  'clan-discovery-projection',
  'discovery-reconciliation',
  'ranked-player-pulse',
  'player-name-verification',
  'ranking-retention',
  'leaderboard-deep-crawl',
  ...leaderboardOperationKinds,
  ...statisticsCollectionKinds,
  'statistics-publication',
  'statistics-legend-meta-publication',
  'esports-refresh',
  'esports-sets-backfill',
]

const scheduledKinds: OperationKind[] = [
  'proof',
  'interactive-player-refresh',
  ...leaderboardOperationKinds,
  'ranking-retention',
  'leaderboard-deep-crawl',
  'clan-weekly-snapshot',
]

// only player refreshes run in cohorts, and only in these classes: a promoted background refresh turns interactive
const cohortKind: OperationKind = 'interactive-player-refresh'
const cohortWorkClasses: readonly WorkClass[] = ['interactive', 'primary-monitoring']

/** The cohort a payload names, or none when it names no cohort telemetry knows. */
export function cohortOf(payload: unknown): OperationCohort {
  if (typeof payload !== 'object' || payload === null || !('cohort' in payload)) return 'none'

  const cohort = operationCohorts.find((known) => known === payload.cohort)

  return cohort ?? 'none'
}

function cohortsOf(workClass: WorkClass, kind: OperationKind): readonly OperationCohort[] {
  if (kind !== cohortKind || !cohortWorkClasses.includes(workClass)) return ['none']

  return operationCohorts
}

function isAdmissionSeriesKept(kind: OperationKind, hasAdmissionRejections: boolean): boolean {
  return hasAdmissionRejections || kind === 'interactive-player-refresh' || kind === 'clan-refresh'
}

function seriesKey(workClass: WorkClass | string, kind: string, reason: DeadLetterReason, cohort: string): string {
  return `${workClass}:${kind}:${reason}:${cohortOf({ cohort })}`
}

function countsBySeries(readings: TelemetryReadings): Map<string, number> {
  const counts = new Map<string, number>()

  for (const row of readings.deadLetters) {
    const key = seriesKey(row.workClass, row.kind, row.reason, row.cohort)

    counts.set(key, (counts.get(key) ?? 0) + row.count)
  }

  return counts
}

function deadLetterSeries(readings: TelemetryReadings): OperationsTelemetrySnapshot['deadLetters'] {
  const counts = countsBySeries(readings)

  // execution series are always present so rate-based alerts see a zero baseline; admission series stay sparse
  // outside the interactive kinds to keep the gauge under the per-metric series bound, and only visitors, outside
  // any cohort, are ever rejected at admission
  return workClasses.flatMap((workClass) =>
    allOperationKinds.flatMap((kind) => {
      const executions = cohortsOf(workClass, kind).map((cohort) => ({
        workClass,
        kind,
        reason: 'execution' as const,
        cohort,
        count: counts.get(seriesKey(workClass, kind, 'execution', cohort)) ?? 0,
      }))

      const admissionRejected = counts.get(seriesKey(workClass, kind, 'admission_rejected', 'none'))

      if (!isAdmissionSeriesKept(kind, admissionRejected !== undefined)) return executions

      const admission = { workClass, kind, reason: 'admission_rejected' as const, cohort: 'none' as const }

      return [...executions, { ...admission, count: admissionRejected ?? 0 }]
    }),
  )
}

/** The telemetry gauges with a zero for every series that has no rows, so alerts always see the series. */
export function buildTelemetrySnapshot(readings: TelemetryReadings): OperationsTelemetrySnapshot {
  const pendingAgeByClass = new Map(readings.oldestPending.map((row) => [row.workClass, row.ageMs]))
  const latenessByKind = new Map(readings.scheduleLateness.map((row) => [row.kind, row.latenessMs]))

  return {
    observedAt: readings.observedAt.toISOString(),
    oldestPending: workClasses.map((workClass) => ({ workClass, ageMs: pendingAgeByClass.get(workClass) ?? 0 })),
    deadLetters: deadLetterSeries(readings),
    scheduleLateness: scheduledKinds.map((kind) => ({ kind, latenessMs: latenessByKind.get(kind) ?? 0 })),
  }
}
