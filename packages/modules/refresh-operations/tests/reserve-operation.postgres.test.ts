import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  acceptOperation,
  activateBound,
  activateReserved,
  findActiveOperation,
  listAwaiting,
  promotePendingWorkClass,
  refreshOperationsModule,
  rejectReserved,
  reserveForAdmission,
  reserveForBinding,
} from '@brawltome/refresh-operations'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_reserve', modules: [refreshOperationsModule] })
})

afterAll(async () => {
  await database?.drop()
})

const provenance = { source: 'integration-test' }

function admissionInput(overrides: { dedupeKey?: string; reservationTtlSeconds?: number } = {}) {
  const key = randomUUID()

  return {
    kind: 'proof' as const,
    dedupeKey: overrides.dedupeKey ?? `reserve:${key}`,
    operationKey: `effect:${key}`,
    workClass: 'interactive' as const,
    payload: { value: 'reserved' },
    provenance,
    maxAttempts: 3,
    reservationTtlSeconds: overrides.reservationTtlSeconds ?? 60,
  }
}

function bindingInput(overrides: { payload?: { value: string } } = {}) {
  const key = randomUUID()

  return {
    kind: 'proof' as const,
    lockNamespace: 209,
    dedupeKey: `binding:${key}`,
    operationKey: `binding:${key}`,
    workClass: 'maintenance' as const,
    payload: overrides.payload ?? { value: 'bound' },
    provenance,
    mismatchMessage: 'binding operation key has a different definition',
  }
}

async function readRow(operationId: string) {
  const [row] = await database.sql<
    {
      status: string
      work_class: string
      reservation_token: string | null
      reservation_expires_at: Date | null
      last_error: { code: string } | null
    }[]
  >`
    SELECT status, work_class, reservation_token, reservation_expires_at, last_error
    FROM refresh_operations.operations WHERE id = ${operationId}
  `

  return row
}

async function collectWakeups(run: () => Promise<unknown>): Promise<string[]> {
  const received: string[] = []
  const subscription = await database.sql.listen('refresh_operations_wakeup', (payload) => received.push(payload))

  try {
    await run()
    await database.sql`SELECT 1`
    await Bun.sleep(100)
  } finally {
    await subscription.unlisten()
  }

  return received
}

describe('acceptOperation', () => {
  test('accepts an operation once and reports the active one on a duplicate', async () => {
    const dedupeKey = `accept:${randomUUID()}`

    const input = {
      kind: 'proof' as const,
      dedupeKey,
      operationKey: `effect:${randomUUID()}`,
      workClass: 'maintenance' as const,
      payload: { value: 'accepted' },
      provenance,
    }

    const first = await acceptOperation(database, input)
    const second = await acceptOperation(database, { ...input, operationKey: `effect:${randomUUID()}` })

    expect(first.outcome).toBe('accepted')
    expect(second).toEqual({ outcome: 'already-active', operationId: first.operationId })

    const row = await readRow(first.operationId)

    expect(row.status).toBe('pending')
  })

  test('wakes idle workers when it accepts', async () => {
    let operationId = ''

    const wakeups = await collectWakeups(async () => {
      const result = await acceptOperation(database, {
        kind: 'proof',
        dedupeKey: `accept:${randomUUID()}`,
        operationKey: `effect:${randomUUID()}`,
        workClass: 'maintenance',
        payload: { value: 'wake' },
        provenance,
      })

      operationId = result.operationId
    })

    expect(wakeups).toEqual([operationId])
  })
})

describe('reserveForAdmission', () => {
  test('reserves, then activates with the reservation token', async () => {
    const reserved = await reserveForAdmission(database, admissionInput())

    if (reserved.outcome !== 'reserved') throw new Error('expected a reservation')

    const awaiting = await readRow(reserved.operationId)

    expect(awaiting.status).toBe('awaiting_admission')
    expect(awaiting.reservation_token).toBe(reserved.reservationToken)

    const wrongToken = await activateReserved(database, {
      operationId: reserved.operationId,
      reservationToken: randomUUID(),
      kinds: ['proof'],
    })

    expect(wrongToken).toBe('lease-lost')

    const wakeups = await collectWakeups(async () => {
      const activated = await activateReserved(database, {
        operationId: reserved.operationId,
        reservationToken: reserved.reservationToken,
        kinds: ['proof'],
      })

      expect(activated).toBe('transitioned')
    })

    expect(wakeups).toEqual([reserved.operationId])

    const pending = await readRow(reserved.operationId)

    expect(pending.status).toBe('pending')
    expect(pending.reservation_token).toBeNull()
    expect(pending.reservation_expires_at).toBeNull()
  })

  test('sends an expired reservation to dead letter and reserves again', async () => {
    const input = admissionInput({ reservationTtlSeconds: 0 })
    const expired = await reserveForAdmission(database, input)

    if (expired.outcome !== 'reserved') throw new Error('expected a reservation')

    const replacement = await reserveForAdmission(database, { ...input, reservationTtlSeconds: 60 })

    expect(replacement.outcome).toBe('reserved')
    expect(replacement.operationId).not.toBe(expired.operationId)

    const row = await readRow(expired.operationId)

    expect(row.status).toBe('dead_letter')
    expect(row.last_error?.code).toBe('admission_reservation_expired')
  })

  test('returns already-active for a duplicate dedupe key', async () => {
    const input = admissionInput()
    const first = await reserveForAdmission(database, input)
    const second = await reserveForAdmission(database, input)

    expect(second).toEqual({ outcome: 'already-active', operationId: first.operationId })
  })

  test('treats a resource key as a duplicate of the active operation holding it', async () => {
    const resourceKey = `proof-resource:${randomUUID()}`
    const first = await reserveForAdmission(database, { ...admissionInput(), resourceKey })
    const second = await reserveForAdmission(database, { ...admissionInput(), resourceKey })

    expect(second).toEqual({ outcome: 'already-active', operationId: first.operationId })
  })

  test('runs beforeInsert in the reserving transaction', async () => {
    const resourceKey = `proof-resource:${randomUUID()}`

    const queued = await acceptOperation(database, {
      kind: 'proof',
      dedupeKey: `queued:${randomUUID()}`,
      operationKey: `effect:${randomUUID()}`,
      resourceKey,
      workClass: 'maintenance',
      payload: { value: 'queued' },
      provenance,
    })

    await reserveForAdmission(
      database,
      { ...admissionInput(), resourceKey },
      {
        beforeInsert: (transaction) =>
          promotePendingWorkClass(transaction, {
            kind: 'proof',
            resourceKey,
            from: 'maintenance',
            to: 'interactive',
            payloadEquals: { value: 'queued' },
          }),
      },
    )

    const row = await readRow(queued.operationId)

    expect(row.work_class).toBe('interactive')
  })

  test('rejects a reservation with its token and records the reason', async () => {
    const reserved = await reserveForAdmission(database, admissionInput())

    if (reserved.outcome !== 'reserved') throw new Error('expected a reservation')

    const rejection = {
      operationId: reserved.operationId,
      reservationToken: reserved.reservationToken,
      reason: 'actor_rate_limited',
      message: 'Admission rejected',
      kinds: ['proof'] as const,
    }

    expect(await rejectReserved(database, { ...rejection, reservationToken: randomUUID() })).toBe('lease-lost')
    expect(await rejectReserved(database, rejection)).toBe('transitioned')

    const row = await readRow(reserved.operationId)

    expect(row.status).toBe('dead_letter')
    expect(row.last_error?.code).toBe('actor_rate_limited')
  })

  test('finds the active operation by dedupe key', async () => {
    const input = admissionInput()
    const reserved = await reserveForAdmission(database, input)

    const found = await findActiveOperation(database, { kind: 'proof', dedupeKey: input.dedupeKey })

    expect(found).toEqual({ operationId: reserved.operationId, awaitingAdmission: true, reservationExpired: false })
    expect(await findActiveOperation(database, { kind: 'proof', dedupeKey: `absent:${randomUUID()}` })).toBeNull()
  })
})

describe('reserveForBinding', () => {
  test('reserves once, returns already-active for the same definition and activates when bound', async () => {
    const input = bindingInput()
    const first = await reserveForBinding(database, input)
    const second = await reserveForBinding(database, input)

    expect(first.outcome).toBe('accepted')
    expect(second).toEqual({ outcome: 'already-active', operationId: first.operationId })
    expect((await readRow(first.operationId)).status).toBe('awaiting_binding')

    const awaiting = await listAwaiting(database, { kinds: ['proof'], status: 'awaiting_binding', limit: 500 })

    expect(awaiting).toContain(first.operationId)

    const wakeups = await collectWakeups(async () => {
      expect(await activateBound(database, first.operationId)).toBe('transitioned')
    })

    expect(wakeups).toEqual([first.operationId])
    expect((await readRow(first.operationId)).status).toBe('pending')
    expect(await activateBound(database, first.operationId)).toBe('transitioned')
    expect(await activateBound(database, randomUUID())).toBe('lease-lost')
  })

  test('throws when the operation key is reserved again with a changed payload', async () => {
    const input = bindingInput()

    await reserveForBinding(database, input)

    const changed = reserveForBinding(database, { ...input, payload: { value: 'changed' } })

    await expect(changed).rejects.toThrow('binding operation key has a different definition')
  })

  test('limits the awaiting list', async () => {
    await reserveForBinding(database, bindingInput())
    await reserveForBinding(database, bindingInput())

    const awaiting = await listAwaiting(database, { kinds: ['proof'], status: 'awaiting_binding', limit: 1 })

    expect(awaiting).toHaveLength(1)
  })
})
