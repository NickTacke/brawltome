import {
  type AttemptOutcome,
  defineJob,
  type JobDefinition,
  type JobTools,
  type Lease,
  type SourceAdmitter,
  sectionCommitted,
} from '@brawltome/refresh-operations'
import type { PostgresRankedPlayers } from '../ranked/postgres'
import { refreshRankedPlayerPulse, type V1RankedPulseSource } from '../ranked/refresh'
import { type RankedPlayerPulsePayload, rankedPlayerPulseContract } from './ranked-player-pulse-contract'

export type RankedPlayerPulseJobDependencies = {
  rankedPlayers: PostgresRankedPlayers
  // the Brawlhalla client, with every call going through the pulse's admission
  createAdmittedPulseSource(admitSource: SourceAdmitter): V1RankedPulseSource
}

type RankedPulseLease = Lease<RankedPlayerPulsePayload>

async function runRankedPulse(
  dependencies: RankedPlayerPulseJobDependencies,
  lease: RankedPulseLease,
  tools: JobTools,
): Promise<AttemptOutcome> {
  const source = dependencies.createAdmittedPulseSource(tools.createSourceAdmitter('ranked-pulse'))

  await refreshRankedPlayerPulse(
    dependencies.rankedPlayers,
    source,
    lease.payload.brawlhallaId,
    { caller: 'background' },
    {
      operationId: lease.operationId,
      effectOperationId: lease.effectOperationId,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      effectCreatedAt: lease.effectCreatedAt,
      section: 'ranked',
    },
  )

  return (await tools.queue.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

export function createRankedPlayerPulseJob(
  dependencies: RankedPlayerPulseJobDependencies,
): JobDefinition<RankedPlayerPulsePayload> {
  return defineJob<RankedPlayerPulsePayload>({
    ...rankedPlayerPulseContract,
    failureCode: 'ranked_player_pulse_failed',
    effectState: (transaction, lease) => sectionCommitted(transaction, lease, 'ranked'),
    run: (lease, tools) => runRankedPulse(dependencies, lease, tools),
  })
}
