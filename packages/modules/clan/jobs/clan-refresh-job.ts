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
import type { PostgresClans } from '../db/postgres-clans'
import type { ClanRefreshEffect } from '../domain/refresh-effect'
import type { ClanRefreshSection } from '../domain/refresh-section'
import { type ClanRefreshPayload, clanRefreshContract } from './clan-refresh-contract'
import { type ClanSectionStore, type ClanSource, processRefreshClanSection } from './refresh-clan'

export type ClanRefreshJobDependencies = {
  clans: ClanSectionStore & Pick<PostgresClans, 'revokeRefreshEffect'>
  // the Brawlhalla client, with every call going through this section's admission
  createAdmittedSource(admitSource: SourceAdmitter): ClanSource
}

type ClanRefreshLease = Lease<ClanRefreshPayload>

// the section the job is inside, so a lease renewal knows which section's authority to update
type ActiveSection = { section: ClanRefreshSection | null }

function sectionEffect(lease: ClanRefreshLease, section: ClanRefreshSection, leaseExpiresAt: Date): ClanRefreshEffect {
  return { operationId: lease.effectOperationId, section, leaseToken: lease.leaseToken, leaseExpiresAt }
}

async function syncLeaseAuthority(
  clans: ClanRefreshJobDependencies['clans'],
  lease: ClanRefreshLease,
  section: ClanRefreshSection,
  leaseExpiresAt: Date,
): Promise<void> {
  const prepared = await clans.prepareRefreshEffect(sectionEffect(lease, section, leaseExpiresAt))

  if (prepared === 'fenced') throw new Error(`${section} refresh lease was fenced`)
}

async function refreshActiveSection(
  dependencies: ClanRefreshJobDependencies,
  lease: ClanRefreshLease,
  active: ActiveSection,
  section: ClanRefreshSection,
  run: SectionRun,
): Promise<void> {
  const { leaseExpiresAt } = run

  if (leaseExpiresAt === undefined) {
    throw new Error(`refresh clan ${lease.payload.clanId} ${section}: renewal gave no lease expiry`)
  }

  active.section = section
  await syncLeaseAuthority(dependencies.clans, lease, section, leaseExpiresAt)

  const result = await processRefreshClanSection(
    dependencies.clans,
    dependencies.createAdmittedSource(run.admitSource),
    lease.payload.clanId,
    section,
    'on-demand',
    new Date(),
    sectionEffect(lease, section, leaseExpiresAt),
  )

  if (result.outcome === 'preserved') throw new Error(result.error ?? `${section} refresh failed`)
}

// a renewal or a loss mid-section has to reach the clan's own copy of the lease, so a fenced worker can't publish
function watchActiveSection(
  clans: ClanRefreshJobDependencies['clans'],
  lease: ClanRefreshLease,
  active: ActiveSection,
  tools: JobTools,
): () => void {
  return tools.watchLease({
    async renewed(leaseExpiresAt) {
      if (active.section) await syncLeaseAuthority(clans, lease, active.section, leaseExpiresAt)
    },
    async lost() {
      if (active.section) await clans.revokeRefreshEffect(sectionEffect(lease, active.section, new Date(0)))
    },
  })
}

async function runClanRefresh(
  dependencies: ClanRefreshJobDependencies,
  lease: ClanRefreshLease,
  tools: JobTools,
): Promise<AttemptOutcome> {
  const active: ActiveSection = { section: null }
  const stopWatching = watchActiveSection(dependencies.clans, lease, active, tools)

  const clearActiveSection = () => {
    active.section = null
  }

  try {
    return await runSections(
      lease,
      lease.payload.staleSections,
      tools,
      (section, run) => refreshActiveSection(dependencies, lease, active, section, run),
      { renewWithAuthority: true, afterSection: clearActiveSection },
    )
  } finally {
    stopWatching()
  }
}

export function createClanRefreshJob(dependencies: ClanRefreshJobDependencies): JobDefinition<ClanRefreshPayload> {
  return defineJob<ClanRefreshPayload>({
    ...clanRefreshContract,
    failureCode: 'clan_refresh_failed',
    effectState: (transaction, lease) => allSectionsCommitted(transaction, lease, lease.payload.staleSections),
    run: (lease, tools) => runClanRefresh(dependencies, lease, tools),
  })
}
