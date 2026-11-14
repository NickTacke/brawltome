// the api's /internal/replays routes, as the worker calls them

const REQUEST_TIMEOUT_MS = 30_000

export type ClaimedReplay = { jobId: string; leaseToken: string; kind: string; bytes: Uint8Array }

export type FailureCode = 'patch-not-supported' | 'worker-error'

export type ApiClient = {
  claim(report: { build: string; patches: string[] }): Promise<ClaimedReplay | null>
  result(jobId: string, leaseToken: string, line: string): Promise<void>
  failure(jobId: string, leaseToken: string, code: FailureCode, message: string): Promise<void>
  renew(jobId: string, leaseToken: string): Promise<boolean>
}

export function createApiClient(config: { apiUrl: string; token: string }): ApiClient {
  const base = `${config.apiUrl.replace(/\/$/, '')}/internal/replays`

  async function post(path: string, init: { headers?: Record<string, string>; body?: BodyInit }): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, ...init.headers },
      body: init.body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }

  return {
    async claim(report) {
      const response = await post('/claim', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      })

      if (response.status === 204) return null

      if (!response.ok) throw new Error(`claim a replay job: the api answered ${response.status}`)

      return {
        jobId: requiredHeader(response, 'x-replay-job'),
        leaseToken: requiredHeader(response, 'x-replay-lease'),
        kind: requiredHeader(response, 'x-replay-kind'),
        bytes: new Uint8Array(await response.arrayBuffer()),
      }
    },

    async result(jobId, leaseToken, line) {
      const body = Bun.gzipSync(new TextEncoder().encode(line))

      const response = await post(`/${jobId}/result`, {
        headers: { 'content-type': 'application/gzip', 'x-replay-lease': leaseToken },
        body,
      })

      // 409: the lease ran out and another attempt owns the job now, so this answer no longer matters
      if (!response.ok && response.status !== 409)
        throw new Error(`send the result of job ${jobId}: ${response.status}`)
    },

    async failure(jobId, leaseToken, code, message) {
      const response = await post(`/${jobId}/failure`, {
        headers: { 'content-type': 'application/json', 'x-replay-lease': leaseToken },
        body: JSON.stringify({ code, message }),
      })

      if (!response.ok && response.status !== 409)
        throw new Error(`send the failure of job ${jobId}: ${response.status}`)
    },

    async renew(jobId, leaseToken) {
      const response = await post(`/${jobId}/renew`, { headers: { 'x-replay-lease': leaseToken } })

      return response.ok
    },
  }
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name)

  if (!value) throw new Error(`claim a replay job: the answer has no ${name}`)

  return value
}
