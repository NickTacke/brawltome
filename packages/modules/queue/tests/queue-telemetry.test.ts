import { describe, expect, test } from 'bun:test'
import { buildTelemetrySnapshot } from '../domain/queue-telemetry'

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

  test('stays within the per-metric series limit of the telemetry package', () => {
    expect(buildTelemetrySnapshot(emptyReadings).deadLetters.length).toBeLessThanOrEqual(256)
  })
})
