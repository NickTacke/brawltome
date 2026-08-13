import type { OperationLease } from '@brawltome/refresh-operations'
import { decodeLifetimeEvidence, decodeRankedEvidence } from '@brawltome/statistics/composition'

type StatisticsLease = Extract<
  OperationLease,
  { kind: 'statistics-ranked-collection' | 'statistics-lifetime-collection' }
>

type StatisticsPlayerSource = {
  getPlayerStatsV1Payload(
    brawlhallaId: number,
    mode: 'ranked_1v1' | 'all',
    options: { caller: 'background' },
  ): Promise<unknown | null>
}

export async function collectStatisticsEvidence(source: StatisticsPlayerSource, lease: StatisticsLease) {
  const mode = lease.kind === 'statistics-ranked-collection' ? 'ranked_1v1' : 'all'
  const payload = await source.getPlayerStatsV1Payload(lease.payload.brawlhallaId, mode, { caller: 'background' })
  if (payload === null) throw new Error(`${mode} Statistics evidence is unavailable`)
  return lease.kind === 'statistics-ranked-collection'
    ? decodeRankedEvidence(payload, lease.payload.brawlhallaId)
    : decodeLifetimeEvidence(payload, lease.payload.brawlhallaId)
}
