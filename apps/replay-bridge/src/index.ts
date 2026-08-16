import { readFileSync } from 'node:fs'

type Fetch = typeof fetch

type FailureAction = 'fix_request' | 'submit_new_job' | 'wait' | 'operator_recovery' | 'report_bug'
type FailureClass = 'usage' | 'input' | 'transient' | 'blocked' | 'internal'
type ProcessorFailure = {
  action: FailureAction
  class: FailureClass
  code: string
  message: string
  details?: { retryAfterSeconds?: number }
}

type WorkerJob =
  | { state: 'running'; jobId: string; statusUrl: string }
  | { state: 'succeeded'; jobId: string; statusUrl: string; resultUrl: string }
  | { state: 'failed'; jobId: string; statusUrl: string; failure: ProcessorFailure }

export type ReplayBridgeConfig = {
  brawltomeUrl: string
  brawltomeToken: string
  processorUrl: string
  processorToken: string
  pollMs: number
}

const MAX_BUSY_ATTEMPTS = 12
const MAX_SUBMISSIONS_PER_CLAIM = 2
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const processorJobIdPattern = /^[A-Za-z0-9_-]{16,128}$/
const failureCodePattern = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*$/
const timestampPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/

function processorFailure(value: unknown): ProcessorFailure {
  if (!value || typeof value !== 'object') throw new Error('Replay Processor returned an invalid failure')
  const record = value as Record<string, unknown>
  const validAction =
    (record.class === 'usage' || record.class === 'input') && record.action === 'fix_request'
      ? true
      : record.class === 'transient' && (record.action === 'submit_new_job' || record.action === 'wait')
        ? true
        : record.class === 'blocked' && record.action === 'operator_recovery'
          ? true
          : record.class === 'internal' && record.action === 'report_bug'
  if (
    record.failureSchemaVersion !== 1 ||
    !validAction ||
    typeof record.code !== 'string' ||
    !failureCodePattern.test(record.code) ||
    typeof record.message !== 'string' ||
    typeof record.occurredAt !== 'string' ||
    !timestampPattern.test(record.occurredAt) ||
    record.message.length < 1 ||
    record.message.length > 256
  ) {
    throw new Error('Replay Processor returned an invalid failure')
  }
  const details = record.details
  if (details !== undefined && (!details || typeof details !== 'object')) {
    throw new Error('Replay Processor returned an invalid failure')
  }
  const retryAfterSeconds = (details as Record<string, unknown> | undefined)?.retryAfterSeconds
  if (retryAfterSeconds !== undefined && (!Number.isInteger(retryAfterSeconds) || Number(retryAfterSeconds) < 1)) {
    throw new Error('Replay Processor returned an invalid failure')
  }
  return {
    action: record.action as FailureAction,
    class: record.class as FailureClass,
    code: record.code,
    message: record.message,
    ...(retryAfterSeconds === undefined ? {} : { details: { retryAfterSeconds: Number(retryAfterSeconds) } }),
  }
}

function workerJob(value: unknown, expectedJobId?: string): WorkerJob {
  if (!value || typeof value !== 'object') throw new Error('Replay Processor returned an invalid job')
  const record = value as Record<string, unknown>
  if (
    record.apiVersion !== 1 ||
    typeof record.jobId !== 'string' ||
    !processorJobIdPattern.test(record.jobId) ||
    typeof record.submittedAt !== 'string' ||
    !timestampPattern.test(record.submittedAt) ||
    (expectedJobId !== undefined && record.jobId !== expectedJobId) ||
    record.statusUrl !== `/v1/jobs/${record.jobId}`
  ) {
    throw new Error('Replay Processor returned an invalid job')
  }
  if (record.state === 'running' && typeof record.startedAt === 'string' && timestampPattern.test(record.startedAt)) {
    return { state: record.state, jobId: record.jobId, statusUrl: record.statusUrl }
  }
  if (
    record.state === 'succeeded' &&
    record.resultUrl === `${record.statusUrl}/result` &&
    typeof record.expiresAt === 'string' &&
    timestampPattern.test(record.expiresAt) &&
    typeof record.terminalAt === 'string' &&
    timestampPattern.test(record.terminalAt)
  ) {
    return {
      state: record.state,
      jobId: record.jobId,
      statusUrl: record.statusUrl,
      resultUrl: record.resultUrl as string,
    }
  }
  if (
    record.state === 'failed' &&
    typeof record.expiresAt === 'string' &&
    timestampPattern.test(record.expiresAt) &&
    typeof record.terminalAt === 'string' &&
    timestampPattern.test(record.terminalAt)
  ) {
    return {
      state: record.state,
      jobId: record.jobId,
      statusUrl: record.statusUrl,
      failure: processorFailure(record.failure),
    }
  }
  throw new Error('Replay Processor returned an invalid job')
}

function url(base: string, path: string): string {
  return new URL(path, `${base.replace(/\/$/, '')}/`).toString()
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error(`HTTP ${response.status} returned invalid JSON`)
  }
}

function bridgeHeaders(config: ReplayBridgeConfig, leaseToken: string, contentType = false): Record<string, string> {
  return {
    authorization: `Bearer ${config.brawltomeToken}`,
    'x-replay-lease-token': leaseToken,
    ...(contentType ? { 'content-type': 'application/json' } : {}),
  }
}

async function reportFailure(
  config: ReplayBridgeConfig,
  fetcher: Fetch,
  id: string,
  leaseToken: string,
  failure: ProcessorFailure,
) {
  const response = await fetcher(url(config.brawltomeUrl, `/internal/replays/${id}/failure`), {
    method: 'POST',
    headers: bridgeHeaders(config, leaseToken, true),
    body: JSON.stringify({ code: failure.code, message: failure.message }),
  })
  if (response.status !== 204) throw new Error(`Brawltome rejected failure callback with HTTP ${response.status}`)
}

async function renewClaim(
  config: ReplayBridgeConfig,
  fetcher: Fetch,
  id: string,
  leaseToken: string,
): Promise<boolean> {
  const response = await fetcher(url(config.brawltomeUrl, `/internal/replays/${id}/renew`), {
    method: 'POST',
    headers: bridgeHeaders(config, leaseToken),
  })
  if (response.status === 204) return true
  if (response.status === 409) return false
  throw new Error(`Brawltome rejected lease renewal with HTTP ${response.status}`)
}

async function releaseClaim(config: ReplayBridgeConfig, fetcher: Fetch, id: string, leaseToken: string) {
  const response = await fetcher(url(config.brawltomeUrl, `/internal/replays/${id}/release`), {
    method: 'POST',
    headers: bridgeHeaders(config, leaseToken),
  })
  if (response.status !== 204) throw new Error(`Brawltome rejected lease release with HTTP ${response.status}`)
}

async function deleteProcessorJob(config: ReplayBridgeConfig, fetcher: Fetch, statusUrl: string) {
  await fetcher(url(config.processorUrl, statusUrl), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${config.processorToken}` },
  }).catch(() => undefined)
}

export async function processNextReplay(
  config: ReplayBridgeConfig,
  fetcher: Fetch = fetch,
  wait: (milliseconds: number) => Promise<unknown> = sleep,
  now: () => number = Date.now,
): Promise<boolean> {
  const claim = await fetcher(url(config.brawltomeUrl, '/internal/replays/claim'), {
    method: 'POST',
    headers: { authorization: `Bearer ${config.brawltomeToken}` },
  })
  if (claim.status === 204) return false
  if (!claim.ok) throw new Error(`Replay claim failed with HTTP ${claim.status}`)
  const id = claim.headers.get('x-replay-job-id')
  const leaseSeconds = Number(claim.headers.get('x-replay-lease-seconds'))
  const leaseToken = claim.headers.get('x-replay-lease-token')
  if (!id || !leaseToken || !Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new Error('Replay claim omitted its identity or lease')
  }
  const renewalIntervalMs = (leaseSeconds * 1_000) / 2
  let renewAt = now() + renewalIntervalMs
  const replayBytes = await claim.arrayBuffer()

  try {
    for (let submissionNumber = 1; submissionNumber <= MAX_SUBMISSIONS_PER_CLAIM; submissionNumber += 1) {
      let current: WorkerJob | undefined
      for (let busyAttempt = 0; busyAttempt < MAX_BUSY_ATTEMPTS; busyAttempt += 1) {
        const submitted = await fetcher(url(config.processorUrl, '/v1/jobs'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.processorToken}`,
            'content-type': 'application/octet-stream',
            'idempotency-key': `${id}:${leaseToken}:${submissionNumber}`,
          },
          body: replayBytes,
        })
        const submittedBody = await json(submitted)
        if (submitted.status === 202) {
          current = workerJob(submittedBody)
          break
        }
        const failure = processorFailure(submittedBody)
        if (failure.action === 'operator_recovery') {
          await wait(config.pollMs)
          await releaseClaim(config, fetcher, id, leaseToken)
          return true
        }
        if (failure.class === 'transient' && failure.action === 'wait') {
          const requestedDelay = failure.details?.retryAfterSeconds ?? Number(submitted.headers.get('retry-after'))
          const retryAfterSeconds = Number.isInteger(requestedDelay) ? Math.min(Math.max(requestedDelay, 1), 10) : 1
          await wait(retryAfterSeconds * 1_000)
          continue
        }
        if (failure.class === 'transient' && failure.action === 'submit_new_job') break
        // pi-lens-ignore: await-in-loop
        await reportFailure(config, fetcher, id, leaseToken, failure)
        return true
      }

      if (!current) {
        if (submissionNumber < MAX_SUBMISSIONS_PER_CLAIM) continue
        await releaseClaim(config, fetcher, id, leaseToken)
        return true
      }

      while (current.state === 'running') {
        if (now() + config.pollMs >= renewAt) {
          // pi-lens-ignore: await-in-loop
          if (!(await renewClaim(config, fetcher, id, leaseToken))) return true
          renewAt = now() + renewalIntervalMs
        }
        // pi-lens-ignore: await-in-loop
        await wait(config.pollMs)
        const status = await fetcher(url(config.processorUrl, current.statusUrl), {
          headers: { authorization: `Bearer ${config.processorToken}` },
        })
        if (!status.ok) throw new Error(`Replay Processor status failed with HTTP ${status.status}`)
        current = workerJob(await json(status), current.jobId)
      }

      if (current.state === 'failed') {
        await deleteProcessorJob(config, fetcher, current.statusUrl)
        if (current.failure.action === 'operator_recovery') {
          await wait(config.pollMs)
          await releaseClaim(config, fetcher, id, leaseToken)
          return true
        }
        if (current.failure.class === 'transient') {
          if (current.failure.action === 'submit_new_job' && submissionNumber < MAX_SUBMISSIONS_PER_CLAIM) continue
          await wait(
            current.failure.details?.retryAfterSeconds
              ? Math.min(current.failure.details.retryAfterSeconds * 1_000, 10_000)
              : config.pollMs,
          )
          await releaseClaim(config, fetcher, id, leaseToken)
          return true
        }
        await reportFailure(config, fetcher, id, leaseToken, current.failure)
        return true
      }

      const result = await fetcher(url(config.processorUrl, current.resultUrl), {
        headers: { authorization: `Bearer ${config.processorToken}` },
      })
      if (!result.ok) throw new Error(`Replay Processor result failed with HTTP ${result.status}`)
      const accepted = await fetcher(url(config.brawltomeUrl, `/internal/replays/${id}/result`), {
        method: 'POST',
        headers: bridgeHeaders(config, leaseToken, true),
        body: await result.arrayBuffer(),
      })
      if (accepted.status !== 204) throw new Error(`Brawltome rejected analysis result with HTTP ${accepted.status}`)

      // pi-lens-ignore: await-in-loop
      await deleteProcessorJob(config, fetcher, current.statusUrl)
      return true
    }
  } catch (error) {
    await releaseClaim(config, fetcher, id, leaseToken).catch(() => undefined)
    throw error
  }
  return true
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readToken(pathVariable: string): string {
  const token = readFileSync(required(pathVariable), 'utf8').trimEnd()
  if (!token || /[\r\n]/.test(token)) throw new Error(`${pathVariable} contains an invalid token`)
  return token
}

function configuration(): ReplayBridgeConfig {
  const pollMs = Number(process.env.REPLAY_BRIDGE_POLL_MS ?? 2_000)
  if (!Number.isInteger(pollMs) || pollMs < 100) throw new Error('REPLAY_BRIDGE_POLL_MS must be at least 100')
  const processorUrl = process.env.REPLAY_PROCESSOR_URL ?? 'http://127.0.0.1:8080'
  let processor: URL
  try {
    processor = new URL(processorUrl)
  } catch {
    throw new Error('REPLAY_PROCESSOR_URL must be a valid loopback URL')
  }
  if (processor.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(processor.hostname)) {
    throw new Error('REPLAY_PROCESSOR_URL must use loopback HTTP')
  }
  return {
    brawltomeUrl: required('BRAWLTOME_API_URL'),
    brawltomeToken: readToken('BRAWLTOME_REPLAY_BRIDGE_TOKEN_FILE'),
    processorUrl,
    processorToken: readToken('REPLAY_PROCESSOR_TOKEN_FILE'),
    pollMs,
  }
}

if (import.meta.main) {
  const config = configuration()
  for (;;) {
    try {
      const processed = await processNextReplay(config)
      if (!processed) await sleep(config.pollMs)
    } catch (error) {
      console.error(error)
      await sleep(config.pollMs)
    }
  }
}
