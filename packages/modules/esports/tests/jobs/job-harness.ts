import type { TestDatabase } from '@brawltome/foundation/testing'
import {
  acceptOperation,
  createPostgresRefreshOperations,
  type JobContract,
  type JobDefinition,
  type SourceAdmissionPort,
  type SourceDomain,
} from '@brawltome/queue'
import type { BrawltoolsClient, GameMode } from '../../source/brawltools-client'
import type { RawLegendCount, RawMatch, RawPlacement, RawPlayer, RawPr } from '../../source/raw-types'

// what the stubbed Brawltools answers; a call named in failures throws its error instead
export type BrawltoolsAnswers = {
  player: RawPlayer | null
  pr: Record<GameMode, RawPr | null>
  placements: Record<GameMode, RawPlacement[]>
  legends: RawLegendCount[]
  matches: Map<string, RawMatch[]>
  failures: Map<string, Error>
}

export function answers(overrides: Partial<BrawltoolsAnswers> = {}): BrawltoolsAnswers {
  return {
    player: null,
    pr: { 1: null, 2: null },
    placements: { 1: [], 2: [] },
    legends: [],
    matches: new Map(),
    failures: new Map(),
    ...overrides,
  }
}

// a client that admits each call first, as the real one does, and names every call it makes
export function stubClient(stub: BrawltoolsAnswers, calls: string[]) {
  return (admit: () => Promise<void>): BrawltoolsClient => {
    async function answer<T>(call: string, value: T): Promise<T> {
      await admit()
      calls.push(call)

      const failure = stub.failures.get(call)

      if (failure) throw failure

      return value
    }

    return {
      playerByBrawlhallaId: () => answer('player', stub.player),
      powerRanking: (_playerId, mode) => answer(`pr ${mode}`, stub.pr[mode]),
      placements: (_playerId, mode) => answer(`placements ${mode}`, stub.placements[mode]),
      matches: (_playerId, tournamentId) => answer(`matches ${tournamentId}`, stub.matches.get(tournamentId) ?? []),
      eventLegends: () => answer('legends', stub.legends),
    }
  }
}

export function rawPlacement(
  tournamentId: string,
  placement: number,
  startTime: Date,
  tournamentName = `Cup ${tournamentId}`,
): RawPlacement {
  return {
    placement,
    tournament: {
      id: tournamentId,
      tournamentName,
      isOfficial: false,
      isOnline: true,
      startTime: Math.floor(startTime.getTime() / 1000),
    },
  }
}

export function createSourceAdmission() {
  const admitted: SourceDomain[] = []
  const pauses: { domain: SourceDomain; seconds: number }[] = []

  const sourceAdmission: SourceAdmissionPort = {
    admitSource: async ({ domain }) => {
      admitted.push(domain)

      return { outcome: 'admitted' }
    },
    pauseSource: async (domain, seconds) => {
      pauses.push({ domain, seconds })
    },
  }

  return { sourceAdmission, admitted, pauses }
}

export function createQueue(database: TestDatabase, job: JobDefinition<unknown>) {
  return createPostgresRefreshOperations({ database }, { jobs: [job] })
}

export async function enqueue(
  database: TestDatabase,
  contract: JobContract<{ brawlhallaId: number }>,
  brawlhallaId: number,
): Promise<void> {
  const key = `${contract.kind}:${brawlhallaId}`

  await acceptOperation(database, {
    job: contract,
    dedupeKey: key,
    operationKey: key,
    workClass: 'maintenance',
    payload: { brawlhallaId },
    provenance: { source: 'integration-test' },
  })
}

export async function readOperation(database: TestDatabase, kind: string) {
  const [operation] = await database.sql<
    { status: string; attemptCount: number; waitSeconds: number; errorCode: string | null }[]
  >`
    SELECT status, attempt_count AS "attemptCount", last_error->>'code' AS "errorCode",
      round(extract(epoch FROM available_at - clock_timestamp()))::int AS "waitSeconds"
    FROM queue.operations WHERE kind = ${kind} ORDER BY created_at DESC LIMIT 1
  `

  if (!operation) throw new Error(`read operation of kind ${kind}: none was written`)

  return operation
}
