import { describe, expect, test } from 'bun:test'
import { type JobDefinition, type Lease, proofEffectState, workClasses } from '@brawltome/refresh-operations'
import { createTelemetry } from '@brawltome/telemetry'
import {
  createWorkerJobs,
  type WorkerAccountsDependencies,
  type WorkerClanDependencies,
  type WorkerDiscoveryDependencies,
} from '../src/worker/job-list'

const playerSource = { name: 'player source' } as unknown as WorkerDiscoveryDependencies['playerSource']
const clanSource = { name: 'clan source' } as unknown as WorkerDiscoveryDependencies['clanSource']

const idleClanDependencies: WorkerClanDependencies = {
  clans: {} as WorkerClanDependencies['clans'],
  createBrawlhallaClient: () => ({}) as ReturnType<WorkerClanDependencies['createBrawlhallaClient']>,
}

const evidenceResolver = { resolve: async () => null }

const idleAccountsDependencies: WorkerAccountsDependencies = {
  accounts: { resolvePrimaryPlayerVerification: async () => ({}) as never },
  createEvidenceResolver: () => evidenceResolver,
}

function createRecordingJobs(
  clan: WorkerClanDependencies = idleClanDependencies,
  accounts: WorkerAccountsDependencies = idleAccountsDependencies,
) {
  const calls: unknown[][] = []

  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])

      return { appliedEvents: 0, eventIds: [] }
    }

  const jobs = createWorkerJobs({
    ranking: { expireGenerations: async () => ({ outcome: 'lease-lost' }) },
    isRankingRetentionEnabled: true,
    telemetry: createTelemetry({ service: 'worker', drainIntervalMs: 0 }),
    discovery: {
      work: {
        deliverPendingPlayers: record('deliverPendingPlayers'),
        deliverPendingClans: record('deliverPendingClans'),
        reconcilePlayers: record('reconcilePlayers'),
        reconcileClans: record('reconcileClans'),
      } as unknown as WorkerDiscoveryDependencies['work'],
      checks: {
        projectionEffectState: async (owner, operationId) => {
          calls.push(['projectionEffectState', owner, operationId])

          return 'applied'
        },
        reconciliationEffectApplied: async (operationId) => {
          calls.push(['reconciliationEffectApplied', operationId])

          return false
        },
      },
      playerSource,
      clanSource,
      leaseActive: async () => true,
    },
    clan,
    accounts,
  })

  return { calls, jobs }
}

function jobOfKind(jobs: JobDefinition<unknown>[], kind: string): JobDefinition<unknown> {
  const job = jobs.find((candidate) => candidate.kind === kind)

  if (!job) throw new Error(`job list has no job for ${kind}`)

  return job
}

function leaseWithPayload(kind: string, payload: unknown): Lease<unknown> {
  return {
    operationId: 'operation',
    effectOperationId: 'effect',
    effectCreatedAt: new Date(0).toISOString(),
    operationKey: `${kind}:test`,
    kind,
    workClass: 'projection',
    payload,
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

async function runJob(job: JobDefinition<unknown>, lease: Lease<unknown>): Promise<void> {
  await job.run(lease, { queue: { complete: async () => 'transitioned' } } as never)
}

function proofLease(operationKey: string): Lease<unknown> {
  return { ...leaseWithPayload('proof', { value: 'attempt' }), operationKey, workClass: 'interactive' }
}

function createProofQueueSpy() {
  const steps: string[] = []

  const queue = {
    commitProofEffect: async () => {
      steps.push('commit effect')

      return 'applied'
    },
    complete: async () => {
      steps.push('complete')

      return 'transitioned'
    },
  }

  return { queue, steps }
}

describe('worker job list', () => {
  test('player and clan projections deliver from their own owner source', async () => {
    const { calls, jobs } = createRecordingJobs()

    await runJob(
      jobOfKind(jobs, 'player-discovery-projection'),
      leaseWithPayload('player-discovery-projection', { batchSize: 7 }),
    )

    await runJob(
      jobOfKind(jobs, 'clan-discovery-projection'),
      leaseWithPayload('clan-discovery-projection', { batchSize: 9 }),
    )

    expect(calls[0]).toEqual(['deliverPendingPlayers', playerSource, 7, 'effect', expect.any(Function)])
    expect(calls[1]).toEqual(['deliverPendingClans', clanSource, 9, 'effect', expect.any(Function)])
  })

  test('reconciliation runs against the source of the owner on its lease', async () => {
    const { calls, jobs } = createRecordingJobs()
    const job = jobOfKind(jobs, 'discovery-reconciliation')

    await runJob(job, leaseWithPayload('discovery-reconciliation', { owner: 'player' }))
    await runJob(job, leaseWithPayload('discovery-reconciliation', { owner: 'clan' }))

    expect(calls[0]).toEqual(['reconcilePlayers', playerSource, 'effect', expect.any(Function)])
    expect(calls[1]).toEqual(['reconcileClans', clanSource, 'effect', expect.any(Function)])
  })

  test('projection effect checks ask discovery about their own owner', async () => {
    const { calls, jobs } = createRecordingJobs()
    const lease = { operationId: 'operation', effectOperationId: 'effect', payload: {} }

    await jobOfKind(jobs, 'player-discovery-projection').effectState?.({} as never, lease)
    await jobOfKind(jobs, 'clan-discovery-projection').effectState?.({} as never, lease)
    await jobOfKind(jobs, 'discovery-reconciliation').effectState?.({} as never, lease)

    expect(calls).toEqual([
      ['projectionEffectState', 'player', 'effect'],
      ['projectionEffectState', 'clan', 'effect'],
      ['reconciliationEffectApplied', 'effect'],
    ])
  })

  test('clan refresh builds its Brawlhalla client around the admission of the running section', async () => {
    const admittedDomains: string[] = []

    const { jobs } = createRecordingJobs({
      clans: {
        prepareRefreshEffect: async () => 'execute',
        recordProfileCheck: async () => true,
      } as unknown as WorkerClanDependencies['clans'],
      createBrawlhallaClient: (beforeRequest) => ({
        getGuildStatsV1: async () => {
          await beforeRequest?.({ domain: 'brawlhalla-v1', path: '/guild' })

          return null
        },
        getGuildMembersV1: async () => null,
      }),
    })

    const tools = {
      queue: {
        renewWithAuthority: async () => ({ outcome: 'renewed', leaseExpiresAt: new Date(Date.now() + 60_000) }),
        beginInteractiveSection: async () => 'execute',
      },
      leaseMs: 1_000,
      signal: new AbortController().signal,
      createSourceAdmitter: () => async (domain: string) => {
        admittedDomains.push(domain)
      },
      watchLease: () => () => {},
    }

    const lease = leaseWithPayload('clan-refresh', { clanId: 77, staleSections: ['profile'] })

    await expect(jobOfKind(jobs, 'clan-refresh').run(lease, tools as never)).rejects.toThrow(
      'ambiguous guild stats 404',
    )

    expect(admittedDomains).toEqual(['brawlhalla-v1'])
  })

  test('a plain proof commits its effect without verifying a primary player', async () => {
    const verifiedAttempts: string[] = []

    const { jobs } = createRecordingJobs(idleClanDependencies, {
      ...idleAccountsDependencies,
      accounts: {
        resolvePrimaryPlayerVerification: async (attemptId) => {
          verifiedAttempts.push(attemptId)

          return {} as never
        },
      },
    })

    const { queue, steps } = createProofQueueSpy()

    expect(await jobOfKind(jobs, 'proof').run(proofLease('proof:plain'), { queue } as never)).toBe('succeeded')
    expect(verifiedAttempts).toEqual([])
    expect(steps).toEqual(['commit effect', 'complete'])
  })

  test('a proof with a primary-player key verifies the attempt before committing its effect', async () => {
    const { queue, steps } = createProofQueueSpy()
    const resolvedWith: unknown[] = []

    const { jobs } = createRecordingJobs(idleClanDependencies, {
      ...idleAccountsDependencies,
      accounts: {
        resolvePrimaryPlayerVerification: async (attemptId, resolver) => {
          steps.push(`verify ${attemptId}`)
          resolvedWith.push(resolver)

          return {} as never
        },
      },
    })

    const outcome = await jobOfKind(jobs, 'proof').run(proofLease('primary-player:attempt'), { queue } as never)

    expect(outcome).toBe('succeeded')
    expect(steps).toEqual(['verify attempt', 'commit effect', 'complete'])
    expect(resolvedWith).toEqual([evidenceResolver])
  })

  test('the proof job reads the proof effect table on an expired lease', async () => {
    const { jobs } = createRecordingJobs()
    const proof = jobOfKind(jobs, 'proof')

    expect(proof.workClasses).toEqual(workClasses)
    expect(proof.failureCode).toBe('proof_execution_failed')
    expect(proof.effectState).toBe(proofEffectState)
  })
})
