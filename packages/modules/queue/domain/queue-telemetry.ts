import {
  type DeadLetterReason,
  leaderboardOperationKinds,
  type OperationLease,
  type OperationsTelemetrySnapshot,
  statisticsCollectionKinds,
  type WorkClass,
  workClasses,
} from '../model'

type OperationKind = OperationLease['kind']

export type TelemetryReadings = {
  observedAt: Date
  oldestPending: { workClass: WorkClass; ageMs: number }[]
  deadLetters: { workClass: WorkClass; kind: string; reason: DeadLetterReason; count: number }[]
  scheduleLateness: { kind: string; latenessMs: number }[]
}

const allOperationKinds: OperationKind[] = [
  'proof',
  'primary-player-verification',
  'interactive-player-refresh',
  'clan-refresh',
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
]

const scheduledKinds: OperationKind[] = [
  'proof',
  'interactive-player-refresh',
  ...leaderboardOperationKinds,
  'ranking-retention',
  'leaderboard-deep-crawl',
]

function isAdmissionSeriesKept(kind: OperationKind, hasAdmissionRejections: boolean): boolean {
  return hasAdmissionRejections || kind === 'interactive-player-refresh' || kind === 'clan-refresh'
}

function deadLetterSeries(readings: TelemetryReadings): OperationsTelemetrySnapshot['deadLetters'] {
  const countsBySeries = new Map(
    readings.deadLetters.map((row) => [`${row.workClass}:${row.kind}:${row.reason}`, row.count]),
  )

  // execution series are always present so rate-based alerts see a zero baseline; admission series stay sparse
  // outside the interactive kinds to keep the gauge under the per-metric series bound
  return workClasses.flatMap((workClass) =>
    allOperationKinds.flatMap((kind) => {
      const admissionRejected = countsBySeries.get(`${workClass}:${kind}:admission_rejected`)

      const execution = {
        workClass,
        kind,
        reason: 'execution' as const,
        count: countsBySeries.get(`${workClass}:${kind}:execution`) ?? 0,
      }

      if (!isAdmissionSeriesKept(kind, admissionRejected !== undefined)) return [execution]

      return [execution, { workClass, kind, reason: 'admission_rejected' as const, count: admissionRejected ?? 0 }]
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
