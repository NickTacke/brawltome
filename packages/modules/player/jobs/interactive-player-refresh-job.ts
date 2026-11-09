import {
  type AttemptOutcome,
  allSectionsCommitted,
  defineJob,
  type JobDefinition,
  type JobTools,
  type Lease,
  runSections,
  type SectionRun,
  type SourceAdmitter,
} from '@brawltome/queue'
import type { CanonicalCareerEffect, PostgresCareerPlayers } from '../career/postgres'
import { refreshCanonicalCareerPlayer, type V0CareerSource } from '../career/refresh'
import type { CareerLegendResolver } from '../career/source'
import type { CanonicalRankedEffect, PostgresRankedPlayers } from '../ranked/postgres'
import { refreshCanonicalRankedPlayer, type V0RankedSource } from '../ranked/refresh'

import {
  type InteractivePlayerRefreshPayload,
  interactivePlayerRefreshContract,
  type PlayerRefreshSection,
} from './interactive-player-refresh-contract'

export type { InteractivePlayerRefreshPayload }

export type PlayerRefreshSource = V0RankedSource & V0CareerSource

export type InteractivePlayerRefreshJobDependencies = {
  rankedPlayers: PostgresRankedPlayers
  careerPlayers: PostgresCareerPlayers
  // the Brawlhalla client, with every call going through this section's admission
  createAdmittedSource(admitSource: SourceAdmitter): PlayerRefreshSource
  isPrimaryMonitoringTarget(assignmentId: string, brawlhallaId: number): Promise<boolean>
  resolveLegendReference: CareerLegendResolver
}

type PlayerRefreshLease = Lease<InteractivePlayerRefreshPayload>

function callerOf(lease: PlayerRefreshLease): 'on-demand' | 'background' {
  return lease.workClass === 'primary-monitoring' ? 'background' : 'on-demand'
}

function accountAssignment(lease: PlayerRefreshLease): string | null {
  const { assignmentId } = lease.payload

  return lease.workClass === 'primary-monitoring' && assignmentId !== undefined ? assignmentId : null
}

function rankedEffect(lease: PlayerRefreshLease): CanonicalRankedEffect {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    effectCreatedAt: lease.effectCreatedAt,
    section: 'ranked',
  }
}

function careerEffect(lease: PlayerRefreshLease): CanonicalCareerEffect {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    section: 'stats',
  }
}

// an account's Primary refresh stops once its assignment ends; a recently viewed refresh belongs to no account
async function completeEndedAssignment(
  dependencies: InteractivePlayerRefreshJobDependencies,
  lease: PlayerRefreshLease,
  tools: JobTools,
): Promise<AttemptOutcome | null> {
  const assignmentId = accountAssignment(lease)

  if (assignmentId === null) return null

  if (await dependencies.isPrimaryMonitoringTarget(assignmentId, lease.payload.brawlhallaId)) return null

  return (await tools.queue.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

// the assignment can end between sections and between calls inside one, so the check runs before each upstream call
function guardAssignment(
  dependencies: InteractivePlayerRefreshJobDependencies,
  lease: PlayerRefreshLease,
  admitSource: SourceAdmitter,
): SourceAdmitter {
  const assignmentId = accountAssignment(lease)

  if (assignmentId === null) return admitSource

  return async (domain) => {
    if (!(await dependencies.isPrimaryMonitoringTarget(assignmentId, lease.payload.brawlhallaId))) {
      throw new Error('Primary Player assignment is no longer current')
    }

    await admitSource(domain)
  }
}

async function refreshSection(
  dependencies: InteractivePlayerRefreshJobDependencies,
  lease: PlayerRefreshLease,
  section: PlayerRefreshSection,
  run: SectionRun,
): Promise<void> {
  const source = dependencies.createAdmittedSource(guardAssignment(dependencies, lease, run.admitSource))
  const caller = callerOf(lease)
  const { brawlhallaId } = lease.payload

  if (section === 'ranked') {
    await refreshCanonicalRankedPlayer(
      dependencies.rankedPlayers,
      source,
      brawlhallaId,
      { caller },
      rankedEffect(lease),
    )

    return
  }

  await refreshCanonicalCareerPlayer(
    dependencies.careerPlayers,
    source,
    brawlhallaId,
    { caller },
    careerEffect(lease),
    dependencies.resolveLegendReference,
  )
}

export function createInteractivePlayerRefreshJob(
  dependencies: InteractivePlayerRefreshJobDependencies,
): JobDefinition<InteractivePlayerRefreshPayload> {
  return defineJob<InteractivePlayerRefreshPayload>({
    ...interactivePlayerRefreshContract,
    failureCode: 'interactive_player_refresh_failed',
    effectState: (transaction, lease) => allSectionsCommitted(transaction, lease, lease.payload.staleSections),
    run: (lease, tools) =>
      runSections(
        lease,
        lease.payload.staleSections,
        tools,
        (section, run) => refreshSection(dependencies, lease, section, run),
        {
          beforeSection: () => completeEndedAssignment(dependencies, lease, tools),
        },
      ),
  })
}
