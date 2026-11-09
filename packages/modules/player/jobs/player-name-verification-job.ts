import {
  type AttemptOutcome,
  defineJob,
  type JobDefinition,
  type JobTools,
  type Lease,
  type SourceAdmitter,
  sectionCommitted,
} from '@brawltome/queue'
import { type PlayerNameVerificationPayload, playerNameVerificationContract } from './player-name-verification-contract'

export type { PlayerNameVerificationPayload }

export type PlayerNameVerificationJobDependencies = {
  verifyName(lease: Lease<PlayerNameVerificationPayload>, admitSource: SourceAdmitter): Promise<unknown>
}

// the verification spends at most one V0 call and records its own outcome, so only a lost lease fails the attempt
async function runNameVerification(
  dependencies: PlayerNameVerificationJobDependencies,
  lease: Lease<PlayerNameVerificationPayload>,
  tools: JobTools,
): Promise<AttemptOutcome> {
  if ((await tools.queue.renew(lease, tools.leaseMs)) === 'lease-lost') return 'lease_lost'

  await dependencies.verifyName(lease, tools.createSourceAdmitter('name-verification'))

  return (await tools.queue.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

export function createPlayerNameVerificationJob(
  dependencies: PlayerNameVerificationJobDependencies,
): JobDefinition<PlayerNameVerificationPayload> {
  return defineJob<PlayerNameVerificationPayload>({
    ...playerNameVerificationContract,
    failureCode: 'player_name_verification_failed',
    effectState: (transaction, lease) => sectionCommitted(transaction, lease, 'ranked'),
    run: (lease, tools) => runNameVerification(dependencies, lease, tools),
  })
}
