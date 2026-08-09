import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { OperationLease } from '@brawltome/refresh-operations'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { runOneProofOperation } from '../src/refresh-operations-worker'
import { createRefreshOperationRoutes } from '../src/routes/refresh-operations.routes'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_operations_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

function requireLease(lease: OperationLease | null): OperationLease {
  if (!lease) throw new Error('Expected an operation lease')
  return lease
}

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Refresh Operations integration tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    await setup.unsafe(refreshOperationsMigrationInventory[0].sql)
  } finally {
    await setup.end()
  }
})

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function expire(operationId: string) {
  const control = postgres(connectionString, { max: 1 })
  try {
    await control`
      UPDATE refresh_operations.operations
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${operationId}
    `
  } finally {
    await control.end()
  }
}

describe('durable Refresh Operations', () => {
  test('deduplicates acceptance, notifies, and reconciles a final-attempt crash after one effect', async () => {
    const producer = createPostgresRefreshOperations(connectionString)
    let notifiedOperationId = ''
    let resolveNotification: (() => void) | undefined
    const notification = new Promise<void>((resolve) => {
      resolveNotification = resolve
    })
    const listener = await producer.listen((operationId) => {
      notifiedOperationId = operationId
      resolveNotification?.()
    })
    const input = {
      dedupeKey: `proof:${randomUUID()}`,
      operationKey: `effect:${randomUUID()}`,
      payload: { value: 'once' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      maxAttempts: 1,
    }
    const accepted = await Promise.all(Array.from({ length: 20 }, () => producer.accept(input)))
    expect(new Set(accepted.map(({ operationId }) => operationId)).size).toBe(1)
    expect(accepted.filter(({ outcome }) => outcome === 'accepted')).toHaveLength(1)
    await notification
    expect(notifiedOperationId).toBe(accepted[0].operationId)
    await listener.unlisten()
    await producer.close()

    const worker = createPostgresRefreshOperations(connectionString)
    const lease = requireLease(await worker.claim('worker-a', 1_000))
    expect(await worker.commitProofEffect(lease)).toBe('applied')
    await expire(lease.operationId)
    expect(await worker.commitProofEffect(lease)).toBe('lease-lost')
    expect(await worker.claim('worker-b', 1_000)).toBeNull()

    const state = await worker.inspect(lease.operationId)
    expect(state.operation.status).toBe('succeeded')
    expect(state.effects).toHaveLength(1)
    expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['succeeded'])
    const afterTerminal = await worker.accept({ ...input, operationKey: `effect:${randomUUID()}` })
    expect(afterTerminal).toMatchObject({ outcome: 'accepted' })
    expect(afterTerminal.operationId).not.toBe(lease.operationId)
    expect(await runOneProofOperation(worker, 'worker-c', { leaseMs: 1_000, retryDelayMs: 1 })).toBe(true)
    await worker.close()
  })

  test('rejects expired and superseded leases and detects conflicting effect keys', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const accepted = await operations.accept({
      dedupeKey: `fence:${randomUUID()}`,
      operationKey: `shared-effect:${randomUUID()}`,
      payload: { value: 'A' },
      provenance: { source: 'integration-test' },
    })
    const stale = requireLease(await operations.claim('worker-a', 1_000))
    await expire(stale.operationId)
    expect(await operations.commitProofEffect(stale)).toBe('lease-lost')
    const current = requireLease(await operations.claim('worker-b', 1_000))
    expect(current.leaseToken).toBeGreaterThan(stale.leaseToken)
    expect(await operations.complete(stale)).toBe('lease-lost')
    expect(await operations.commitProofEffect(current)).toBe('applied')
    expect(await operations.complete(current)).toBe('transitioned')

    const conflicting = await operations.accept({
      dedupeKey: `conflict:${randomUUID()}`,
      operationKey: current.operationKey,
      payload: { value: 'B' },
      provenance: { source: 'integration-test' },
    })
    expect(await runOneProofOperation(operations, 'worker-c', { leaseMs: 1_000, retryDelayMs: 1 })).toBe(true)
    const conflictState = await operations.inspect(conflicting.operationId)
    expect(conflictState.operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'effect_conflict', retryable: false },
    })
    expect(conflictState.effects).toHaveLength(0)
    expect((await operations.inspect(accepted.operationId)).effects).toHaveLength(1)
    await operations.close()
  })

  test('runs the real route-to-polling-worker seam and dead-letters bounded runtime failures', async () => {
    const producer = createPostgresRefreshOperations(connectionString)
    const secret = 'operations-integration-secret-operations'
    const app = createRefreshOperationRoutes(producer, secret)
    const response = await app.request('/proof', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        dedupeKey: `route:${randomUUID()}`,
        operationKey: `route-effect:${randomUUID()}`,
        value: 'from-route',
      }),
    })
    const accepted = (await response.json()) as { operationId: string }
    expect(response.status).toBe(202)
    await producer.close()

    const worker = createPostgresRefreshOperations(connectionString)
    expect(await runOneProofOperation(worker, 'poll-worker', { leaseMs: 1_000, retryDelayMs: 1 })).toBe(true)
    expect((await worker.inspect(accepted.operationId)).operation.status).toBe('succeeded')

    const poison = await worker.accept({
      dedupeKey: `poison:${randomUUID()}`,
      operationKey: `poison-effect:${randomUUID()}`,
      payload: { value: 'poison' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      maxAttempts: 2,
    })
    const failEffect = async () => {
      throw new Error('Deliberate proof failure')
    }
    const options = { leaseMs: 1_000, retryDelayMs: 0, executeEffect: failEffect }
    expect(await runOneProofOperation(worker, 'worker-a', options)).toBe(true)
    expect(await runOneProofOperation(worker, 'worker-b', options)).toBe(true)

    const state = await worker.inspect(poison.operationId)
    expect(state.operation).toMatchObject({
      status: 'dead_letter',
      payload: { value: 'poison' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      attempt_count: 2,
      last_error: {
        code: 'proof_execution_failed',
        message: 'Deliberate proof failure',
        retryable: true,
      },
    })
    expect(state.attempts).toHaveLength(2)
    expect(state.attempts.every(({ outcome, error }) => outcome && error?.code === 'proof_execution_failed')).toBe(true)
    expect(state.effects).toHaveLength(0)
    await worker.close()
  })
})
