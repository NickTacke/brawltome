import { describe, expect, mock, test } from 'bun:test'
import type { ReplayJobs } from '@brawltome/replays'
import { createReplayWorkerRoutes } from '../src/routes/replay-worker.routes'

const token = 'replay-worker-token-for-tests-32-bytes-long'
const jobId = '1b2f7508-8e9c-4b1a-950f-d60fabe27176'
const leaseToken = '9d3c1f0e-0a51-4f6c-9a43-5d1e2f3a4b5c'
const auth = { authorization: `Bearer ${token}` }

function routes(overrides: Partial<ReplayJobs> = {}) {
  const jobs: ReplayJobs = {
    claim: mock(async () => null),
    complete: mock(async () => 'completed' as const),
    fail: mock(async () => true),
    renew: mock(async () => true),
    release: mock(async () => true),
    ...overrides,
  }

  return { app: createReplayWorkerRoutes({ jobs, token }), jobs }
}

function claimRequest(headers: Record<string, string> = auth) {
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ build: 'dev-1', patches: ['11.00'] }),
  }
}

describe('replay worker routes', () => {
  test('refuse a request without the bearer token', async () => {
    const { app, jobs } = routes()

    const response = await app.request('/claim', claimRequest({ authorization: 'Bearer wrong' }))

    expect(response.status).toBe(401)
    expect(jobs.claim).not.toHaveBeenCalled()
  })

  test('answer 204 when there is no job', async () => {
    const { app } = routes()

    const response = await app.request('/claim', claimRequest())

    expect(response.status).toBe(204)
  })

  test('a claim returns the replay bytes with the lease in headers', async () => {
    const claim = mock(async () => ({
      jobId,
      leaseToken,
      kind: 'parse' as const,
      digest: `sha256:${'a'.repeat(64)}`,
      replayBytes: Uint8Array.of(0x78, 0xda, 1),
    }))

    const { app } = routes({ claim })

    const response = await app.request('/claim', claimRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('x-replay-job')).toBe(jobId)
    expect(response.headers.get('x-replay-lease')).toBe(leaseToken)
    expect(response.headers.get('x-replay-kind')).toBe('parse')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(0x78, 0xda, 1))
    expect(claim).toHaveBeenCalledWith({ build: 'dev-1', patches: ['11.00'] })
  })

  test('a result arrives gzipped and reaches the jobs as text', async () => {
    const { app, jobs } = routes()

    const response = await app.request(`/${jobId}/result`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/gzip', 'x-replay-lease': leaseToken },
      body: Bun.gzipSync(new TextEncoder().encode('{"exit":2}')),
    })

    expect(response.status).toBe(204)
    expect(jobs.complete).toHaveBeenCalledWith({ jobId, leaseToken, line: '{"exit":2}' })
  })

  test('a result over 8 MiB gzipped is refused', async () => {
    const { app, jobs } = routes()

    const response = await app.request(`/${jobId}/result`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/gzip', 'x-replay-lease': leaseToken },
      body: new Uint8Array(8 * 1024 * 1024 + 1),
    })

    expect(response.status).toBe(413)
    expect(jobs.complete).not.toHaveBeenCalled()
  })

  test('a result after the lease was lost answers 409', async () => {
    const { app } = routes({ complete: mock(async () => 'lease-lost' as const) })

    const response = await app.request(`/${jobId}/result`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/gzip', 'x-replay-lease': leaseToken },
      body: Bun.gzipSync(new TextEncoder().encode('{}')),
    })

    expect(response.status).toBe(409)
  })

  test('a failure with an unknown code is refused', async () => {
    const { app, jobs } = routes()

    const response = await app.request(`/${jobId}/failure`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', 'x-replay-lease': leaseToken },
      body: JSON.stringify({ code: 'made-up', message: 'x' }),
    })

    expect(response.status).toBe(400)
    expect(jobs.fail).not.toHaveBeenCalled()
  })

  test('renew and release answer 409 when the lease is gone', async () => {
    const { app } = routes({ renew: mock(async () => false), release: mock(async () => false) })
    const request = { method: 'POST', headers: { ...auth, 'x-replay-lease': leaseToken } }

    expect((await app.request(`/${jobId}/renew`, request)).status).toBe(409)
    expect((await app.request(`/${jobId}/release`, request)).status).toBe(409)
  })
})
