import { RequestQueue } from '@brawltome/bhapi'
import {
  decodeLifetimeEvidence,
  decodeRankedEvidence,
  LAUNCH_COHORT_SOURCE_QUOTA_UNITS,
  LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS,
  type StatisticsCollectionLease,
} from '@brawltome/statistics'

const collectionWindowMs = LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS * 1_000

export const STATISTICS_COLLECTION_SPACING_MS = collectionWindowMs / LAUNCH_COHORT_SOURCE_QUOTA_UNITS

// the shared worker queue is sized for the V0 key; collection only calls V1, and at full speed it would take
// every background slot there and hold on-demand refreshes behind it. evenly spaced calls also stay under V1's bursts
export function createStatisticsCollectionQueue(): RequestQueue {
  return new RequestQueue({
    minSpacingMs: STATISTICS_COLLECTION_SPACING_MS,
    sustainedLimit: LAUNCH_COHORT_SOURCE_QUOTA_UNITS,
    sustainedWindowMs: collectionWindowMs,
  })
}

export type StatisticsCollectionPace = { waitMsForTurn(operationId: string): number }

// gives every operation its own 6-second slot, and the job defers until then instead of holding a worker slot while it
// waits. without a booking per operation, every queued job would be claimed and put back on each pass
export function createStatisticsCollectionPace(now: () => number = Date.now): StatisticsCollectionPace {
  let lastSlotAt = 0
  const bookedSlots = new Map<string, number>()

  return {
    waitMsForTurn(operationId) {
      const currentTime = now()
      const bookedAt = bookedSlots.get(operationId)

      if (bookedAt !== undefined && bookedAt <= currentTime) {
        bookedSlots.delete(operationId)

        return 0
      }

      if (bookedAt !== undefined) return bookedAt - currentTime

      const nextSlotAt = Math.max(currentTime, lastSlotAt + STATISTICS_COLLECTION_SPACING_MS)

      lastSlotAt = nextSlotAt
      if (nextSlotAt === currentTime) return 0

      bookedSlots.set(operationId, nextSlotAt)

      return nextSlotAt - currentTime
    },
  }
}

type StatisticsPlayerSource = {
  getPlayerStatsV1Payload(
    brawlhallaId: number,
    mode: 'ranked_1v1' | 'all',
    options: { caller: 'background' },
  ): Promise<unknown | null>
}

// what the worker wires in. the queue stays as the guard on the real call if a slot is reached late
export function createStatisticsCollection(createSource: (queue: RequestQueue) => StatisticsPlayerSource) {
  const queue = createStatisticsCollectionQueue()
  const collectionPace = createStatisticsCollectionPace()

  return {
    collectionPace,
    collectEvidence: (lease: Pick<StatisticsCollectionLease, 'kind' | 'payload'>) =>
      collectStatisticsEvidence(createSource(queue), lease),
  }
}

export async function collectStatisticsEvidence(
  source: StatisticsPlayerSource,
  lease: Pick<StatisticsCollectionLease, 'kind' | 'payload'>,
) {
  const mode = lease.kind === 'statistics-ranked-collection' ? 'ranked_1v1' : 'all'
  const payload = await source.getPlayerStatsV1Payload(lease.payload.brawlhallaId, mode, { caller: 'background' })

  if (payload === null) throw new Error(`${mode} Statistics evidence is unavailable`)

  return lease.kind === 'statistics-ranked-collection'
    ? decodeRankedEvidence(payload, lease.payload.brawlhallaId)
    : decodeLifetimeEvidence(payload, lease.payload.brawlhallaId)
}
