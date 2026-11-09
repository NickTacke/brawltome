import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  createPostgresRefreshOperations,
  interactiveRefreshMaxAttempts,
  proofContract,
  queueModule,
  reserveForAdmission,
} from '@brawltome/queue'
import { clanModule } from '../../index'
import { clanRefreshContract } from '../../jobs/clan-refresh-contract'
import {
  activateClanRefresh,
  findActiveClanRefresh,
  rejectClanRefresh,
  reserveClanRefresh,
} from '../../jobs/clan-refresh-reservation'

let database: TestDatabase
let queue: ReturnType<typeof createPostgresRefreshOperations>

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'clan_refresh_reservation',
    modules: [queueModule, clanModule],
  })

  queue = createPostgresRefreshOperations({ database }, { jobs: [clanRefreshContract, proofContract] })
})

afterAll(async () => {
  await database?.drop()
})

function reservationInput(key: string = randomUUID()) {
  return {
    dedupeKey: `clan:${key}`,
    operationKey: `clan:${key}`,
    clanId: 77,
    staleSections: ['profile', 'roster'] as ('profile' | 'roster')[],
    provenance: { source: 'integration-test' },
    reservationTtlSeconds: 30,
  }
}

async function reserveClan(key?: string) {
  const reserved = await reserveClanRefresh(database, reservationInput(key))

  if (reserved.outcome !== 'reserved') throw new Error('expected a clan reservation')

  return reserved
}

async function reserveOtherKind() {
  const key = randomUUID()

  const reserved = await reserveForAdmission(database, {
    job: proofContract,
    dedupeKey: `proof:${key}`,
    operationKey: `proof:${key}`,
    workClass: 'interactive',
    payload: { value: 'proof' },
    provenance: { source: 'integration-test' },
    maxAttempts: 3,
    reservationTtlSeconds: 30,
  })

  if (reserved.outcome !== 'reserved') throw new Error('expected a proof reservation')

  return reserved
}

describe('clan refresh reservations', () => {
  test('reserves an interactive clan-refresh operation with the interactive retry budget', async () => {
    const reserved = await reserveClan()

    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({
      kind: 'clan-refresh',
      work_class: 'interactive',
      status: 'awaiting_admission',
      max_attempts: interactiveRefreshMaxAttempts,
      payload: { clanId: 77, staleSections: ['profile', 'roster'] },
    })
  })

  test('finds the active reservation and reports a repeat as already active', async () => {
    const key = randomUUID()
    const reserved = await reserveClan(key)

    expect(await findActiveClanRefresh(database, `clan:${key}`)).toMatchObject({
      operationId: reserved.operationId,
      awaitingAdmission: true,
      reservationExpired: false,
    })

    expect(await reserveClanRefresh(database, reservationInput(key))).toEqual({
      outcome: 'already-active',
      operationId: reserved.operationId,
    })

    expect(await findActiveClanRefresh(database, `clan:${randomUUID()}`)).toBeNull()
  })

  test('activates a held reservation into the queue', async () => {
    const reserved = await reserveClan()

    expect(await activateClanRefresh(database, reserved.operationId, randomUUID())).toBe('lease-lost')
    expect(await activateClanRefresh(database, reserved.operationId, reserved.reservationToken)).toBe('transitioned')
    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({ status: 'pending' })
  })

  test('rejects a held reservation with the reason as its error code', async () => {
    const reserved = await reserveClan()

    expect(
      await rejectClanRefresh(database, reserved.operationId, reserved.reservationToken, 'actor_rate_limited'),
    ).toBe('transitioned')

    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'actor_rate_limited', message: 'Interactive refresh admission rejected' },
    })
  })

  test('leaves operations of other kinds alone', async () => {
    const other = await reserveOtherKind()

    expect(await activateClanRefresh(database, other.operationId, other.reservationToken)).toBe('lease-lost')

    expect(await rejectClanRefresh(database, other.operationId, other.reservationToken, 'actor_rate_limited')).toBe(
      'lease-lost',
    )

    expect((await queue.inspect(other.operationId)).operation).toMatchObject({ status: 'awaiting_admission' })
  })
})
