import { sourceRetryAfterMs } from '../domain/job-errors'
import type { AttemptOutcome, JobTools, Lease, SourceAdmitter } from './job-definition'

export type SectionRun = {
  admitSource: SourceAdmitter
  // only set when the job asked for `renewWithAuthority`
  leaseExpiresAt?: Date
}

export type RunSectionsOptions<Section extends string> = {
  // checked before a section renews; a returned outcome ends the job there
  beforeSection?(section: Section): Promise<AttemptOutcome | null>
  // renews through renewWithAuthority so the section can bind its effect to the new expiry
  renewWithAuthority?: boolean
  // runs once a section has committed or failed
  afterSection?(section: Section): void
}

type SectionRenewal = { isLeaseLost: false; leaseExpiresAt?: Date } | { isLeaseLost: true }

async function renewForSection(
  lease: Lease<unknown>,
  tools: JobTools,
  withAuthority: boolean,
): Promise<SectionRenewal> {
  if (!withAuthority) {
    const renewal = await tools.queue.renew(lease, tools.leaseMs)

    return renewal === 'lease-lost' ? { isLeaseLost: true } : { isLeaseLost: false }
  }

  const authority = await tools.queue.renewWithAuthority(lease, tools.leaseMs)

  if (authority.outcome === 'lease-lost') return { isLeaseLost: true }

  return { isLeaseLost: false, leaseExpiresAt: authority.leaseExpiresAt }
}

// an execution failure beats a source wait, otherwise the longest source wait covers every section
function selectSectionFailure(failures: readonly unknown[]): unknown {
  const executionFailure = failures.find((error) => sourceRetryAfterMs(error) === null)

  if (executionFailure) return executionFailure

  const retryAware = failures
    .map((error) => ({ error, retryAfterMs: sourceRetryAfterMs(error) }))
    .filter((failure): failure is { error: unknown; retryAfterMs: number } => failure.retryAfterMs !== null)
    .sort((left, right) => right.retryAfterMs - left.retryAfterMs)[0]

  return retryAware?.error ?? failures[0]
}

async function completeLease(lease: Lease<unknown>, tools: JobTools): Promise<AttemptOutcome> {
  return (await tools.queue.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

export async function runSections<Section extends string>(
  lease: Lease<unknown>,
  sections: readonly Section[],
  tools: JobTools,
  runSection: (section: Section, run: SectionRun) => Promise<void>,
  options: RunSectionsOptions<Section> = {},
): Promise<AttemptOutcome> {
  const failures: unknown[] = []

  for (const section of sections) {
    if (tools.signal.aborted) return 'lease_lost'

    const earlyOutcome = await options.beforeSection?.(section)

    if (earlyOutcome) return earlyOutcome

    const renewal = await renewForSection(lease, tools, options.renewWithAuthority === true)

    if (renewal.isLeaseLost) return 'lease_lost'

    const checkpoint = await tools.queue.beginInteractiveSection(lease, section)

    if (checkpoint === 'lease-lost' || tools.signal.aborted) return 'lease_lost'

    if (checkpoint === 'already-applied') continue

    const admitSource = tools.createSourceAdmitter(section)

    try {
      await runSection(section, { admitSource, leaseExpiresAt: renewal.leaseExpiresAt })

      if (tools.signal.aborted) return 'lease_lost'

      if ((await tools.queue.commitInteractiveSection(lease, section)) === 'lease-lost') return 'lease_lost'
    } catch (error) {
      failures.push(error)
    } finally {
      options.afterSection?.(section)
    }
  }

  if (tools.signal.aborted) return 'lease_lost'

  if (failures.length > 0) throw selectSectionFailure(failures)

  return completeLease(lease, tools)
}
