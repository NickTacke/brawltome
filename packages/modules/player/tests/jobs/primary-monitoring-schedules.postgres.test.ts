import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { playerModule } from '../../index'
import { reconcilePrimaryMonitoring } from '../../jobs/primary-monitoring-schedules'

let database: TestDatabase

const dayMs = 24 * 60 * 60 * 1000

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'primary_monitoring_schedules',
    modules: [queueModule, playerModule],
  })
})

afterAll(async () => {
  await database?.drop()
})

function target(overrides: { brawlhallaId?: number; assignmentId?: string; verifiedAt?: Date } = {}) {
  return {
    assignmentId: overrides.assignmentId ?? randomUUID(),
    brawlhallaId: overrides.brawlhallaId ?? 501,
    verifiedAt: overrides.verifiedAt ?? new Date('2026-08-01T12:00:00.000Z'),
  }
}

function schedules() {
  return database.sql<
    {
      schedule_key: string
      resource_key: string
      kind: string
      work_class: string
      interval_ms: string
      first_due_at: Date
      payload: Record<string, unknown>
      provenance: Record<string, unknown>
      max_attempts: number
      enabled: boolean
    }[]
  >`SELECT * FROM refresh_operations.schedules WHERE provenance->>'source' = 'primary-player-monitoring'`
}

describe('reconcilePrimaryMonitoring', () => {
  test('writes the same schedule the queue used to write', async () => {
    const verifiedAt = new Date('2026-08-01T12:00:00.000Z')
    const assignmentId = randomUUID()

    expect(
      await reconcilePrimaryMonitoring(database, {
        observedAt: new Date(Date.now() + 1_000),
        targets: [target({ brawlhallaId: 501, assignmentId, verifiedAt })],
      }),
    ).toEqual({ created: 1, retired: 0 })

    const [schedule] = await schedules()

    expect(schedule).toMatchObject({
      schedule_key: `primary-player:501:${assignmentId}`,
      resource_key: 'player:501',
      kind: 'interactive-player-refresh',
      work_class: 'primary-monitoring',
      payload: { assignmentId, brawlhallaId: 501, staleSections: ['ranked', 'stats'] },
      provenance: { source: 'primary-player-monitoring', requestedBy: 'issue-208' },
      max_attempts: 3,
      enabled: true,
    })

    expect(Number(schedule.interval_ms)).toBe(dayMs)
    expect(schedule.first_due_at.getTime()).toBe(verifiedAt.getTime() + dayMs)
  })

  test('rejects an invalid snapshot before writing anything', async () => {
    const observedAt = new Date(Date.now() + 2_000)

    await expect(reconcilePrimaryMonitoring(database, { observedAt: new Date('nope'), targets: [] })).rejects.toThrow(
      'Primary monitoring snapshot requires a valid observedAt',
    )

    await expect(
      reconcilePrimaryMonitoring(database, { observedAt, targets: [target({ brawlhallaId: 0 })] }),
    ).rejects.toThrow('Primary monitoring requires a positive safe Brawlhalla ID')

    await expect(
      reconcilePrimaryMonitoring(database, { observedAt, targets: [target({ assignmentId: 'not-a-uuid' })] }),
    ).rejects.toThrow('Primary monitoring requires a UUID assignmentId')

    await expect(
      reconcilePrimaryMonitoring(database, {
        observedAt,
        targets: [target({ brawlhallaId: 77 }), target({ brawlhallaId: 77 })],
      }),
    ).rejects.toThrow('Primary monitoring snapshot contains duplicate players')
  })
})
