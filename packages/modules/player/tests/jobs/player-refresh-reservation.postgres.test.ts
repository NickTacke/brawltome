import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { interactivePlayerRefreshContract } from '@brawltome/player'
import {
  createPostgresRefreshOperations,
  interactiveRefreshMaxAttempts,
  proofContract,
  refreshOperationsModule,
  reserveForAdmission,
} from '@brawltome/queue'
import { playerModule } from '../../index'
import {
  activateAdmittedInteractivePlayerRefresh,
  activateInteractivePlayerRefresh,
  findActiveInteractivePlayerRefresh,
  rejectExpiredInteractivePlayerRefresh,
  rejectInteractivePlayerRefresh,
  reserveInteractivePlayerRefresh,
} from '../../jobs/player-refresh-reservation'

let database: TestDatabase
let queue: ReturnType<typeof createPostgresRefreshOperations>

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'player_refresh_reservation',
    modules: [refreshOperationsModule, playerModule],
  })

  queue = createPostgresRefreshOperations({ database }, { jobs: [interactivePlayerRefreshContract, proofContract] })
})

afterAll(async () => {
  await database?.drop()
})

let nextBrawlhallaId = 10_000

function reservationInput(key: string = randomUUID(), brawlhallaId = nextBrawlhallaId++) {
  return {
    dedupeKey: `player:${key}`,
    operationKey: `player:${key}`,
    brawlhallaId,
    staleSections: ['ranked', 'stats'] as ('ranked' | 'stats')[],
    provenance: { source: 'integration-test' },
    reservationTtlSeconds: 30,
  }
}

async function reservePlayer(key?: string, brawlhallaId?: number) {
  const reserved = await reserveInteractivePlayerRefresh(database, reservationInput(key, brawlhallaId))

  if (reserved.outcome !== 'reserved') throw new Error('expected a player reservation')

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

async function queueRecentlyViewed(brawlhallaId: number): Promise<string> {
  const id = randomUUID()

  await database.sql`
    INSERT INTO refresh_operations.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
    VALUES
      (${id}, ${id}, 'interactive-player-refresh', ${`freshness:${id}`}, ${`freshness:${id}`}, 'primary-monitoring',
       ${database.sql.json({ cohort: 'recently-viewed', brawlhallaId, staleSections: ['ranked', 'stats'] })},
       ${database.sql.json({ source: 'freshness-planner' })}, 4)
  `

  return id
}

describe('player refresh reservations', () => {
  test('reserves an interactive player operation on its resource with the interactive retry budget', async () => {
    const brawlhallaId = nextBrawlhallaId++
    const reserved = await reservePlayer(undefined, brawlhallaId)

    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({
      kind: 'interactive-player-refresh',
      work_class: 'interactive',
      status: 'awaiting_admission',
      max_attempts: interactiveRefreshMaxAttempts,
      resource_key: `player:${brawlhallaId}`,
      payload: { brawlhallaId, staleSections: ['ranked', 'stats'] },
    })
  })

  test('finds the active reservation by dedupe key or by player, and reports a repeat as already active', async () => {
    const key = randomUUID()
    const brawlhallaId = nextBrawlhallaId++
    const reserved = await reservePlayer(key, brawlhallaId)

    expect(await findActiveInteractivePlayerRefresh(database, `player:${key}`)).toMatchObject({
      operationId: reserved.operationId,
      awaitingAdmission: true,
      reservationExpired: false,
    })

    expect(await findActiveInteractivePlayerRefresh(database, 'no-such-key', brawlhallaId)).toMatchObject({
      operationId: reserved.operationId,
    })

    expect(await findActiveInteractivePlayerRefresh(database, 'no-such-key')).toBeNull()

    expect(await reserveInteractivePlayerRefresh(database, reservationInput(key, brawlhallaId))).toEqual({
      outcome: 'already-active',
      operationId: reserved.operationId,
    })
  })

  test('activates a held reservation into the queue', async () => {
    const reserved = await reservePlayer()

    expect(await activateInteractivePlayerRefresh(database, reserved.operationId, randomUUID())).toBe('lease-lost')

    expect(await activateInteractivePlayerRefresh(database, reserved.operationId, reserved.reservationToken)).toBe(
      'transitioned',
    )

    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({ status: 'pending' })
  })

  test('activates an admitted reservation without its token', async () => {
    const reserved = await reservePlayer()

    expect(await activateAdmittedInteractivePlayerRefresh(database, reserved.operationId)).toBe('transitioned')
    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({ status: 'pending' })
  })

  test('rejects a held reservation with the reason as its error code', async () => {
    const reserved = await reservePlayer()

    expect(
      await rejectInteractivePlayerRefresh(
        database,
        reserved.operationId,
        reserved.reservationToken,
        'actor_rate_limited',
      ),
    ).toBe('transitioned')

    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'actor_rate_limited', message: 'Interactive refresh admission rejected' },
    })
  })

  test('leaves an unexpired reservation alone when asked to reject it as expired', async () => {
    const reserved = await reservePlayer()

    expect(await rejectExpiredInteractivePlayerRefresh(database, reserved.operationId)).toBe('lease-lost')
    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({ status: 'awaiting_admission' })
  })

  test('leaves operations of other kinds alone', async () => {
    const other = await reserveOtherKind()

    expect(await activateInteractivePlayerRefresh(database, other.operationId, other.reservationToken)).toBe(
      'lease-lost',
    )

    expect(await activateAdmittedInteractivePlayerRefresh(database, other.operationId)).toBe('lease-lost')

    expect(
      await rejectInteractivePlayerRefresh(database, other.operationId, other.reservationToken, 'actor_rate_limited'),
    ).toBe('lease-lost')

    expect(await rejectExpiredInteractivePlayerRefresh(database, other.operationId)).toBe('lease-lost')
    expect((await queue.inspect(other.operationId)).operation).toMatchObject({ status: 'awaiting_admission' })
  })

  test('promotes a queued recently viewed refresh when a visitor asks for the same player', async () => {
    const brawlhallaId = nextBrawlhallaId++
    const queued = await queueRecentlyViewed(brawlhallaId)

    const reservation = await reserveInteractivePlayerRefresh(database, reservationInput(undefined, brawlhallaId))

    expect(reservation).toEqual({ outcome: 'already-active', operationId: queued })
    expect((await queue.inspect(queued)).operation).toMatchObject({ work_class: 'interactive' })
  })
})
