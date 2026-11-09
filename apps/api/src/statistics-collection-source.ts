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

type StatisticsPlayerSource = {
  getPlayerStatsV1Payload(
    brawlhallaId: number,
    mode: 'ranked_1v1' | 'all',
    options: { caller: 'background' },
  ): Promise<unknown | null>
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
