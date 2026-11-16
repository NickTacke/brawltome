import type { WorkerReport } from './api-client'

// the api's /internal/replays/art routes, as the worker calls them. the worker holds no storage keys: every art file
// goes through the api, which checks it before it reaches the bucket

const REQUEST_TIMEOUT_MS = 30_000
// a result writes the manifest to the bucket before it answers, so it gets longer
const RESULT_TIMEOUT_MS = 120_000
// as many paths as the api answers in one missing call
const PATHS_PER_CALL = 2000
// the job id names the job's files under the work folder, so it must be nothing but an id
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ClaimedArt = {
  jobId: string
  leaseToken: string
  kind: 'match' | 'warm'
  patch: string
  // the match's line, unzipped; null for a warm job
  line: Uint8Array | null
}

export type ArtJob = Pick<ClaimedArt, 'jobId' | 'leaseToken'>

export type ArtMap = { patch: string; mapId: number; path: string }
export type ArtResult = { manifest: Record<string, unknown> | null; maps: ArtMap[]; artFormat: number }
export type ArtFailureCode = 'no-animations' | 'export-failed' | 'worker-error'

/** The api answered 409: the attempt lost its lease, so nothing more it sends about the job counts. */
export class LeaseLostError extends Error {}

/**
 * A result got no answer: the api may have stored it or not. It is never sent again, nor followed by a failure: a
 * second complete or a failure racing the first could undo it. The lease running out settles it.
 */
export class ResultUnansweredError extends Error {}

/** The api answered 422: it won't take a file or the manifest, so the export made something it can't store. */
export class ArtRefusedError extends Error {}

export type ArtClient = {
  claim(report: WorkerReport): Promise<ClaimedArt | null>
  missing(job: ArtJob, paths: string[]): Promise<string[]>
  readFile(job: ArtJob, path: string): Promise<Uint8Array>
  putFile(job: ArtJob, path: string, bytes: Uint8Array): Promise<'stored' | 'held'>
  result(job: ArtJob, result: ArtResult): Promise<void>
  failure(job: ArtJob, code: ArtFailureCode, message: string): Promise<void>
  renew(job: ArtJob): Promise<boolean>
}

type RequestInit = { method?: string; lease?: string; json?: unknown; bytes?: Uint8Array; timeoutMs?: number }

export type ArtClientConfig = { apiUrl: string; token: string; resultTimeoutMs?: number }

export function createArtClient(config: ArtClientConfig): ArtClient {
  const base = `${config.apiUrl.replace(/\/$/, '')}/internal/replays/art`

  async function send(path: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${config.token}` }

    if (init.lease) headers['x-art-lease'] = init.lease

    if (init.json !== undefined) headers['content-type'] = 'application/json'

    return fetch(`${base}${path}`, {
      method: init.method ?? 'POST',
      headers,
      body: init.json === undefined ? bodyOf(init.bytes) : JSON.stringify(init.json),
      redirect: 'error',
      signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  }

  return {
    claim: async (report) => claimFrom(await send('/claim', { json: report })),

    async missing(job, paths) {
      const missing: string[] = []

      for (let start = 0; start < paths.length; start += PATHS_PER_CALL) {
        const chunk = paths.slice(start, start + PATHS_PER_CALL)
        const response = await send(`/${job.jobId}/missing`, { lease: job.leaseToken, json: { paths: chunk } })

        await expectOk(response, `ask which art files job ${job.jobId} must send`)
        missing.push(...((await response.json()) as { missing: string[] }).missing)
      }

      return missing
    },

    async readFile(job, path) {
      const response = await send(`/${job.jobId}/files/${path}`, { method: 'GET', lease: job.leaseToken })

      await expectOk(response, `read art file ${path} for job ${job.jobId}`)

      return new Uint8Array(await response.arrayBuffer())
    },

    // held: another attempt is uploading the same path (423), so this one sends it again later
    async putFile(job, path, bytes) {
      const response = await send(`/${job.jobId}/files/${path}`, { method: 'PUT', lease: job.leaseToken, bytes })

      if (response.status === 423) return 'held'

      await expectOk(response, `send art file ${path} for job ${job.jobId}`)

      return 'stored'
    },

    async result(job, result) {
      const timeoutMs = config.resultTimeoutMs ?? RESULT_TIMEOUT_MS
      const request = { lease: job.leaseToken, json: result, timeoutMs }

      const response = await send(`/${job.jobId}/result`, request).catch((error: unknown) => {
        throw new ResultUnansweredError(`send the art of job ${job.jobId}: no answer: ${String(error)}`)
      })

      await expectOk(response, `send the art of job ${job.jobId}`)
    },

    async failure(job, code, message) {
      const response = await send(`/${job.jobId}/failure`, { lease: job.leaseToken, json: { code, message } })

      // 409: another attempt owns the job now, so this answer no longer matters
      if (!response.ok && response.status !== 409) {
        throw new Error(`send the art failure of job ${job.jobId}: the api answered ${response.status}`)
      }
    },

    // false only once the api says the lease is gone; any other answer is a failed request, not a lost lease
    async renew(job) {
      const response = await send(`/${job.jobId}/renew`, { lease: job.leaseToken })

      if (response.status === 409) return false

      await expectOk(response, `renew art job ${job.jobId}`)

      return true
    },
  }
}

// copied into a plain buffer, which fetch takes as a body
function bodyOf(bytes: Uint8Array | undefined): Uint8Array<ArrayBuffer> | undefined {
  return bytes === undefined ? undefined : new Uint8Array(bytes)
}

async function claimFrom(response: Response): Promise<ClaimedArt | null> {
  if (response.status === 204) return null

  if (!response.ok) throw new Error(`claim an art job: the api answered ${response.status}`)

  const kind = requiredHeader(response, 'x-art-kind')

  if (kind !== 'match' && kind !== 'warm') throw new Error(`claim an art job: unknown kind ${kind}`)

  const jobId = requiredHeader(response, 'x-art-job')

  if (!UUID.test(jobId)) throw new Error(`claim an art job: x-art-job ${jobId.slice(0, 60)} is not a uuid`)

  const body = new Uint8Array(await response.arrayBuffer())

  return {
    jobId,
    leaseToken: requiredHeader(response, 'x-art-lease'),
    kind,
    patch: requiredHeader(response, 'x-art-patch'),
    line: kind === 'match' ? Bun.gunzipSync(body) : null,
  }
}

async function expectOk(response: Response, action: string): Promise<void> {
  if (response.ok) return

  const reason = (await response.text()).slice(0, 300)

  if (response.status === 409) throw new LeaseLostError(`${action}: the job's lease is gone`)

  if (response.status === 422) throw new ArtRefusedError(`${action}: the api refused it: ${reason}`)

  throw new Error(`${action}: the api answered ${response.status} ${reason}`.trim())
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name)

  if (!value) throw new Error(`claim an art job: the answer has no ${name}`)

  return value
}
