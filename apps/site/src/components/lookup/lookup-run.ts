import type { RefreshAnswer } from '../refresh/refresh-answer'
import { askUntilSettled, pollUntilRefreshed, type RefreshRun, reload } from '../refresh/refresh-run'

export type LookupStatus = 'looking' | 'found' | 'missing' | 'refused' | 'unverified' | 'failed'

/** A refresh run for a player the site has never stored; isRefreshed says whether a read finds the player now. */
export type LookupRun = Omit<RefreshRun, 'setStatus'> & { setStatus: (status: LookupStatus) => void }

function failedStatus(answer: RefreshAnswer): LookupStatus {
  if (answer.kind === 'refused') return 'refused'

  if (answer.kind === 'verify') return 'unverified'

  // the api took the lookup but no player turned up, which is all brawlhalla says about an id it doesn't know
  if (answer.kind === 'refreshing' || answer.kind === 'fresh') return 'missing'

  return 'failed'
}

async function isFoundAfter(run: LookupRun, answer: RefreshAnswer): Promise<boolean> {
  if (answer.kind === 'fresh') {
    await reload(run)

    return run.isRefreshed()
  }

  if (answer.kind !== 'refreshing') return false

  return pollUntilRefreshed(run, answer.pollAfterSeconds)
}

/** Asks the api to look a player up, then reads until the player appears or the wait runs out. */
export async function runLookup(run: LookupRun): Promise<void> {
  run.setStatus('looking')

  const answer = await askUntilSettled(run)
  const isFound = await isFoundAfter(run, answer)

  if (run.isCancelled()) return

  run.setStatus(isFound ? 'found' : failedStatus(answer))
}
