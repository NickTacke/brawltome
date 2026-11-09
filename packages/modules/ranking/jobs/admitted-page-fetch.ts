import type { JobTools, Lease, SourceAdmissionPort } from '@brawltome/queue'
import { observeSourceCall, type Telemetry } from '@brawltome/telemetry'
import { LeaderboardLeaseLostError, type LeaderboardPageSource } from '../leaderboard'
import { LeaderboardSourceError } from '../v1-leaderboard-source'

export type AdmittedPageFetchDependencies = {
  source: LeaderboardPageSource
  sourceAdmission: Pick<SourceAdmissionPort, 'admitSource'>
  waitForSourceAdmission(retryAfterMs: number, signal: AbortSignal): Promise<void>
  waitForSourceRetry(delayMs: number, signal: AbortSignal): Promise<void>
  telemetry: Telemetry
}

type PageFetchContext = {
  lease: Lease<unknown>
  tools: Pick<JobTools, 'queue' | 'leaseMs' | 'signal'>
  dependencies: AdmittedPageFetchDependencies
}

type PageRequest = Parameters<LeaderboardPageSource['fetchPage']>[0]

// transient V1 page failures retry in place; 429s stay with durable rate-limit backoff
const transientPageRetryDelaysMs = [500, 2_000] as const

function isTransientPageFailure(error: unknown): boolean {
  return (
    error instanceof LeaderboardSourceError &&
    error.retryable &&
    (error.code === 'source_transport_failed' || error.code === 'source_unavailable')
  )
}

async function renewLease({ lease, tools }: PageFetchContext): Promise<void> {
  if ((await tools.queue.renew(lease, tools.leaseMs)) === 'lease-lost') throw new LeaderboardLeaseLostError()
}

function throwIfLeaseLost({ tools }: PageFetchContext): void {
  if (tools.signal.aborted) throw new LeaderboardLeaseLostError()
}

// waits out source admission without giving up the page; the lease is renewed around every wait
async function waitUntilAdmitted(reservationKey: string, context: PageFetchContext): Promise<void> {
  const { dependencies, tools } = context

  for (;;) {
    const admission = await dependencies.sourceAdmission.admitSource({
      domain: 'brawlhalla-v1',
      reservationKey,
      units: 1,
      caller: 'background',
    })

    if (admission.outcome === 'admitted') return

    await dependencies.waitForSourceAdmission(admission.retryAfterSeconds * 1_000, tools.signal)
    throwIfLeaseLost(context)

    await renewLease(context)
  }
}

async function waitBeforePageRetry(retry: number, error: unknown, context: PageFetchContext): Promise<void> {
  const delayMs = transientPageRetryDelaysMs[retry]

  if (delayMs === undefined || !isTransientPageFailure(error)) throw error

  await context.dependencies.waitForSourceRetry(delayMs, context.tools.signal)
  throwIfLeaseLost(context)
}

function callSource(input: PageRequest, { dependencies }: PageFetchContext) {
  return observeSourceCall(dependencies.telemetry, 'brawlhalla-v1', () => dependencies.source.fetchPage(input))
}

// each retry is a real source call, so it needs its own reservation
function reservationKeyFor(pageKey: string, retry: number): string {
  return retry === 0 ? pageKey : `${pageKey}:retry-${retry}`
}

async function fetchPageWithRetries(input: PageRequest, context: PageFetchContext) {
  const { lease } = context
  const pageKey = `${lease.operationId}:${lease.leaseToken}:${input.mode}:${input.region}:${input.page}`

  for (let retry = 0; ; retry += 1) {
    await renewLease(context)
    await waitUntilAdmitted(reservationKeyFor(pageKey, retry), context)
    await renewLease(context)

    try {
      return await callSource(input, context)
    } catch (error) {
      await waitBeforePageRetry(retry, error, context)
    }
  }
}

// fetches one V1 leaderboard page with background source admission, renewing the lease around each wait and retrying
// transient page failures in place
export function createAdmittedPageFetch(
  lease: Lease<unknown>,
  tools: PageFetchContext['tools'],
  dependencies: AdmittedPageFetchDependencies,
): LeaderboardPageSource['fetchPage'] {
  const context: PageFetchContext = { lease, tools, dependencies }

  return (input) => fetchPageWithRetries(input, context)
}
