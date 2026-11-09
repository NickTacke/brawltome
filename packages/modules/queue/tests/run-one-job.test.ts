import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  type AdmissionConfig,
  createJobRegistry,
  createPostgresRefreshOperations,
  defineJob,
  type FailureDecision,
  type JobDefinition,
  type Lease,
  refreshOperationsModule,
  runOneJob,
  type WorkClass,
} from '@brawltome/queue'
import { runJobOnce, testJobContract } from '@brawltome/queue/testing'

const admission: AdmissionConfig = {
  totalConcurrency: 4,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 2,
  },
  backgroundWeights: {
    'primary-monitoring': 5,
    leaderboard: 4,
    'global-statistics': 3,
    projection: 2,
    maintenance: 1,
  },
}

const sourceOutage = Object.assign(new Error('Brawlhalla is in maintenance'), {
  status: 503,
  domain: 'brawlhalla-v1',
})

type TestJob = Omit<JobDefinition<unknown>, 'kind' | 'workClasses' | 'failureCode' | 'parsePayload'>

function testJob(job: TestJob): JobDefinition<unknown> {
  return defineJob({
    kind: testJobContract.kind,
    workClasses: ['maintenance'],
    failureCode: 'test_job_failed',
    parsePayload: (value) => value,
    ...job,
  })
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()

  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

async function waitForRenewals(renewals: readonly string[], method: string): Promise<void> {
  while (!renewals.includes(method)) await Bun.sleep(1)
}

function createSourceAdmissionSpy() {
  const paused: { domain: string; seconds: number }[] = []

  return {
    paused,
    sourceAdmission: {
      admitSource: async () => ({ outcome: 'admitted' as const }),
      pauseSource: async (domain: string, seconds: number) => {
        paused.push({ domain, seconds })
      },
    },
  }
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_run_one_job', modules: [refreshOperationsModule] })
})

afterAll(async () => {
  await database?.drop()
})

async function acceptProofOperation(): Promise<{
  operations: ReturnType<typeof createPostgresRefreshOperations>
  operationId: string
}> {
  const operations = createPostgresRefreshOperations({ database }, { jobs: [testJobContract] })
  const key = randomUUID()

  const accepted = await operations.accept({
    job: testJobContract,
    dedupeKey: key,
    operationKey: key,
    workClass: 'maintenance',
    payload: { value: key },
    provenance: { source: 'test' },
  })

  return { operations, operationId: accepted.operationId }
}

async function readOperation(operationId: string) {
  const [row] = await database.sql<{ status: string; attempt_count: number }[]>`
    SELECT status, attempt_count FROM refresh_operations.operations WHERE id = ${operationId}
  `

  return row
}

function runOptions(overrides: Partial<Parameters<typeof runOneJob>[3]> = {}) {
  return { leaseMs: 30_000, retryDelayMs: 1_000, sourceUnavailableRetryMs: 60_000, admission, ...overrides }
}

describe('createJobRegistry', () => {
  test('createJobRegistry throws on a duplicate kind', () => {
    const job = testJob({ run: async () => 'succeeded' })

    expect(() => createJobRegistry([job, job])).toThrow('test-job')
  })

  test('createJobRegistry throws on an unknown work class', () => {
    const job = {
      ...testJob({ run: async () => 'succeeded' }),
      workClasses: ['nightly'] as unknown as readonly WorkClass[],
    }

    expect(() => createJobRegistry([job])).toThrow('nightly')
  })

  test('a registry names the kind it has no job for', () => {
    const registry = createJobRegistry([])

    expect(() => registry.get('test-job')).toThrow('test-job')
  })
})

describe('runOneJob', () => {
  test('runOneJob settles a thrown 503 by pausing the source and deferring', async () => {
    const { operations, operationId } = await acceptProofOperation()
    const { paused, sourceAdmission } = createSourceAdmissionSpy()

    const job = testJob({
      run: async () => {
        throw sourceOutage
      },
    })

    const ran = await runOneJob(operations, 'worker-source-outage', createJobRegistry([job]), {
      ...runOptions(),
      sourceAdmission,
    })

    expect(ran).toBe(true)
    expect(paused).toEqual([{ domain: 'brawlhalla-v1', seconds: 60 }])
    expect(await readOperation(operationId)).toEqual({ status: 'pending', attempt_count: 0 })
  })

  test('runOneJob uses a job decideFailure before the source and execution tables', async () => {
    const { operations, operationId } = await acceptProofOperation()
    const { paused, sourceAdmission } = createSourceAdmissionSpy()
    const decisions: unknown[] = []

    const job = testJob({
      run: async () => {
        throw sourceOutage
      },
      decideFailure: async (error, lease: Lease<unknown>): Promise<FailureDecision> => {
        decisions.push([error, lease.operationId])

        return { action: 'complete' }
      },
    })

    await runOneJob(operations, 'worker-job-decision', createJobRegistry([job]), { ...runOptions(), sourceAdmission })

    expect(decisions).toEqual([[sourceOutage, operationId]])
    expect(paused).toEqual([])
    expect((await readOperation(operationId)).status).toBe('succeeded')
  })

  test('runOneJob falls through to the source table when a job decideFailure has no opinion', async () => {
    const { operations, operationId } = await acceptProofOperation()
    const { paused, sourceAdmission } = createSourceAdmissionSpy()

    const job = testJob({
      run: async () => {
        throw sourceOutage
      },
      decideFailure: async () => null,
    })

    await runOneJob(operations, 'worker-no-opinion', createJobRegistry([job]), { ...runOptions(), sourceAdmission })

    expect(paused).toHaveLength(1)
    expect((await readOperation(operationId)).status).toBe('pending')
  })

  test('runOneJob retries an applied effect for whichever kind asks, without spending the attempt', async () => {
    const { operations, operationId } = await acceptProofOperation()

    const job = testJob({
      run: async () => {
        throw new Error('owner acknowledgment failed')
      },
      decideFailure: async (): Promise<FailureDecision> => ({ action: 'retry-applied-effect' }),
    })

    // a long delay parks the row so later tests in this file don't claim it
    await runOneJob(operations, 'worker-applied-effect', createJobRegistry([job]), runOptions({ retryDelayMs: 60_000 }))

    expect(await readOperation(operationId)).toEqual({ status: 'pending', attempt_count: 1 })
  })

  test('runOneJob calls watcher.lost and aborts the signal when renewal reports lease-lost', async () => {
    const { operations, operationId } = await acceptProofOperation()
    let lostCalls = 0
    let signalAborted = false

    const job = testJob({
      run: async (_lease, tools) => {
        const unwatch = tools.watchLease({
          renewed: async () => undefined,
          lost: async () => {
            lostCalls++
          },
        })

        await database.sql`
          UPDATE refresh_operations.operations SET lease_owner = 'someone-else' WHERE id = ${operationId}
        `

        await waitForAbort(tools.signal)
        signalAborted = tools.signal.aborted
        unwatch()

        return 'lease_lost'
      },
    })

    const ran = await runOneJob(operations, 'worker-lease-lost', createJobRegistry([job]), {
      ...runOptions(),
      renewEveryMs: 5,
    })

    expect(ran).toBe(true)
    expect(signalAborted).toBe(true)
    expect(lostCalls).toBe(1)
  })

  test('runOneJob renews with authority only while a watcher is registered', async () => {
    const { operations } = await acceptProofOperation()
    const renewals: string[] = []
    const expiries: Date[] = []

    const countingQueue = {
      ...operations,
      renew: (lease: Parameters<typeof operations.renew>[0], leaseMs: number) => {
        renewals.push('renew')

        return operations.renew(lease, leaseMs)
      },
      renewWithAuthority: (lease: Parameters<typeof operations.renew>[0], leaseMs: number) => {
        renewals.push('renewWithAuthority')

        return operations.renewWithAuthority(lease, leaseMs)
      },
    }

    const job = testJob({
      run: async (lease, tools) => {
        await waitForRenewals(renewals, 'renew')

        const unwatch = tools.watchLease({
          renewed: async (leaseExpiresAt) => {
            expiries.push(leaseExpiresAt)
          },
          lost: async () => undefined,
        })

        while (expiries.length === 0) await Bun.sleep(1)

        unwatch()

        await tools.queue.complete(lease)

        return 'succeeded'
      },
    })

    await runOneJob(countingQueue, 'worker-renewal-choice', createJobRegistry([job]), {
      ...runOptions(),
      renewEveryMs: 5,
    })

    expect(renewals[0]).toBe('renew')
    expect(renewals).toContain('renewWithAuthority')
    expect(expiries[0]).toBeInstanceOf(Date)
  })
})

describe('runJobOnce', () => {
  test('runJobOnce claims the job kind and returns its outcome', async () => {
    const { operations, operationId } = await acceptProofOperation()

    const outcome = await runJobOnce(
      operations,
      testJob({
        run: async (lease, tools) => {
          await tools.queue.complete(lease)

          return 'succeeded'
        },
      }),
      { admission },
    )

    expect(outcome).toBe('succeeded')
    expect((await readOperation(operationId)).status).toBe('succeeded')
  })
})
