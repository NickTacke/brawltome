import type { RefreshAnswer } from './refresh-answer'

export type RefreshStatus = 'idle' | 'updating' | 'failed'

/** What one refresh of a page needs; the hook passes the real ones, tests pass fakes. */
export type RefreshRun = {
  request: (turnstileToken?: string) => Promise<RefreshAnswer>
  // null when the visitor could not be verified
  solveChallenge: (siteKey: string | null) => Promise<string | null>
  reload: () => Promise<void>
  isRefreshed: () => boolean
  wait: (milliseconds: number) => Promise<void>
  isCancelled: () => boolean
  setStatus: (status: RefreshStatus) => void
}

// what asking for a refresh needs, and what reloading the data until it changes needs
type AskingRun = Pick<RefreshRun, 'request' | 'solveChallenge' | 'wait' | 'isCancelled'>
type PollingRun = Pick<RefreshRun, 'reload' | 'isRefreshed' | 'wait' | 'isCancelled'>

type RetryableAnswer = Extract<RefreshAnswer, { kind: 'refused' | 'unavailable' }>

// the refresh job retries the game's api for about a minute, so this leaves room for a few of its rounds
const longestWaitMs = 90_000
const automaticRetries = 2
// a longer wait means the visitor's own limit, worth telling them instead of keeping the line on "updating"
const longestAutomaticRetrySeconds = 60
const longestPollDelaySeconds = 8
const failedRequest: RefreshAnswer = { kind: 'unavailable', retryAfterSeconds: 30 }

function isRetryable(answer: RefreshAnswer): answer is RetryableAnswer {
  if (answer.kind !== 'refused' && answer.kind !== 'unavailable') return false

  return answer.retryAfterSeconds <= longestAutomaticRetrySeconds
}

async function ask(run: AskingRun, turnstileToken?: string): Promise<RefreshAnswer> {
  try {
    return await run.request(turnstileToken)
  } catch {
    return failedRequest
  }
}

async function askWithChallenge(run: AskingRun): Promise<RefreshAnswer> {
  const answer = await ask(run)

  if (answer.kind !== 'verify') return answer

  const turnstileToken = await run.solveChallenge(answer.siteKey)

  if (!turnstileToken) return answer

  return ask(run, turnstileToken)
}

/** Asks for a refresh, answering a challenge and retrying short refusals, until the api gives a lasting answer. */
export async function askUntilSettled(run: AskingRun): Promise<RefreshAnswer> {
  let answer = await askWithChallenge(run)

  for (let retry = 0; retry < automaticRetries && isRetryable(answer); retry += 1) {
    await run.wait(answer.retryAfterSeconds * 1_000)

    if (run.isCancelled()) return answer

    answer = await askWithChallenge(run)
  }

  return answer
}

// a failed load keeps the data already on screen, the next look may work
export async function reload(run: Pick<RefreshRun, 'reload'>): Promise<boolean> {
  try {
    await run.reload()

    return true
  } catch {
    return false
  }
}

// starts at the api's hint and backs off a second per look, so a slow refresh costs few reads
export async function pollUntilRefreshed(run: PollingRun, firstDelaySeconds: number): Promise<boolean> {
  let waitedMs = 0

  for (let look = 0; waitedMs < longestWaitMs; look += 1) {
    const delayMs = Math.min(firstDelaySeconds + look, longestPollDelaySeconds) * 1_000

    await run.wait(delayMs)
    waitedMs += delayMs

    if (run.isCancelled()) return false

    await reload(run)

    if (run.isRefreshed()) return true
  }

  return false
}

/** Asks for a refresh of a stale page and reloads its data until the fresh data lands or the wait runs out. */
export async function runRefresh(run: RefreshRun): Promise<void> {
  run.setStatus('updating')

  const answer = await askUntilSettled(run)
  const isFreshLoaded = answer.kind === 'fresh' && (await reload(run))
  const isRefreshed = answer.kind === 'refreshing' && (await pollUntilRefreshed(run, answer.pollAfterSeconds))

  if (run.isCancelled()) return

  run.setStatus(isFreshLoaded || isRefreshed ? 'idle' : 'failed')
}
