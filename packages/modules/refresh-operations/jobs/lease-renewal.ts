import type { Lease, LeaseOperations, LeaseWatcher } from './job-definition'

export type LeaseRenewal = {
  leaseLost: AbortSignal
  watchLease(watcher: LeaseWatcher): () => void
  stop(): Promise<void>
}

type RenewalTarget = {
  queue: Pick<LeaseOperations, 'renew' | 'renewWithAuthority'>
  lease: Lease<unknown>
  leaseMs: number
  watchers: Set<LeaseWatcher>
}

export function waitForRenewal(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }

    const timer = setTimeout(done, intervalMs)

    signal.addEventListener('abort', done, { once: true })
  })
}

// only a watcher needs the new expiry, so everything else keeps the plain renew statement
async function renewOnce({ queue, lease, leaseMs, watchers }: RenewalTarget): Promise<boolean> {
  if (watchers.size === 0) return (await queue.renew(lease, leaseMs)) !== 'lease-lost'

  const authority = await queue.renewWithAuthority(lease, leaseMs)

  if (authority.outcome === 'lease-lost') return false

  for (const watcher of [...watchers]) {
    await watcher.renewed(authority.leaseExpiresAt)
  }

  return true
}

async function renewUntilStopped(
  target: RenewalTarget,
  intervalMs: number,
  stopped: AbortSignal,
  leaseLost: AbortController,
): Promise<void> {
  const reportLeaseLost = async () => {
    leaseLost.abort()

    for (const watcher of [...target.watchers]) {
      await watcher.lost().catch(() => undefined)
    }
  }

  while (!stopped.aborted) {
    await waitForRenewal(intervalMs, stopped)

    if (stopped.aborted) return

    const isRenewed = await renewOnce(target).catch(() => false)

    if (!isRenewed) {
      await reportLeaseLost()

      return
    }
  }
}

export function startLeaseRenewal(
  queue: RenewalTarget['queue'],
  lease: Lease<unknown>,
  leaseMs: number,
  intervalMs: number,
): LeaseRenewal {
  const stopController = new AbortController()
  const leaseLost = new AbortController()
  const watchers = new Set<LeaseWatcher>()

  const renewing = renewUntilStopped({ queue, lease, leaseMs, watchers }, intervalMs, stopController.signal, leaseLost)

  return {
    leaseLost: leaseLost.signal,
    watchLease(watcher) {
      watchers.add(watcher)

      return () => {
        watchers.delete(watcher)
      }
    },
    async stop() {
      stopController.abort()
      await renewing
    },
  }
}
