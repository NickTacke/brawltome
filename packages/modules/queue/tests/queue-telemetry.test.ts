import { describe, expect, test } from 'bun:test'
import { buildTelemetrySnapshot, cohortOf } from '../domain/queue-telemetry'

const emptyReadings = {
  observedAt: new Date('2026-11-09T12:00:00.000Z'),
  oldestPending: [],
  deadLetters: [],
  scheduleLateness: [],
}

describe('queue telemetry snapshot', () => {
  test('reports a zero dead letter series for the clan weekly snapshot in every work class', () => {
    const { deadLetters } = buildTelemetrySnapshot(emptyReadings)
    const snapshotSeries = deadLetters.filter(({ kind }) => kind === 'clan-weekly-snapshot')

    expect(snapshotSeries).toHaveLength(6)
    expect(snapshotSeries.every(({ count, reason }) => count === 0 && reason === 'execution')).toBe(true)
  })

  test('reports the lateness of the clan weekly snapshot schedule', () => {
    const { scheduleLateness } = buildTelemetrySnapshot({
      ...emptyReadings,
      scheduleLateness: [{ kind: 'clan-weekly-snapshot', latenessMs: 40 }],
    })

    expect(scheduleLateness).toContainEqual({ kind: 'clan-weekly-snapshot', latenessMs: 40 })
  })

  test('splits player refresh dead letters by cohort, so coverage can be told apart', () => {
    const { deadLetters } = buildTelemetrySnapshot({
      ...emptyReadings,
      deadLetters: [
        {
          workClass: 'primary-monitoring',
          kind: 'interactive-player-refresh',
          reason: 'execution',
          cohort: 'ranked-coverage',
          count: 3,
        },
        {
          workClass: 'primary-monitoring',
          kind: 'interactive-player-refresh',
          reason: 'execution',
          cohort: 'none',
          count: 1,
        },
      ],
    })

    const monitoring = deadLetters.filter(
      ({ workClass, kind, reason }) =>
        workClass === 'primary-monitoring' && kind === 'interactive-player-refresh' && reason === 'execution',
    )

    expect(monitoring.map(({ cohort, count }) => [cohort, count])).toEqual([
      ['none', 1],
      ['recently-viewed', 0],
      ['ranked-coverage', 3],
    ])

    expect(deadLetters.filter(({ kind }) => kind === 'leaderboard-1v1').every(({ cohort }) => cohort === 'none')).toBe(
      true,
    )
  })

  test('reads the cohort from a payload, and none when it names no known one', () => {
    expect(cohortOf({ cohort: 'ranked-coverage', brawlhallaId: 1 })).toBe('ranked-coverage')
    expect(cohortOf({ cohort: 'recently-viewed' })).toBe('recently-viewed')
    expect(cohortOf({ cohort: 'someone-else' })).toBe('none')
    expect(cohortOf({ brawlhallaId: 1 })).toBe('none')
    expect(cohortOf(null)).toBe('none')
  })

  test('stays within the per-metric series limit of the telemetry package', () => {
    expect(buildTelemetrySnapshot(emptyReadings).deadLetters.length).toBeLessThanOrEqual(256)
  })
})
