import { describe, expect, mock, test } from 'bun:test'
import type { ClaimedArtJob, ReplayArtJobs, ReplayJobs } from '@brawltome/replays'
import { createReplayWorkerRoutes } from '../src/routes/replay-worker.routes'

const token = 'replay-worker-token-for-tests-32-bytes-long'
const jobId = '1b2f7508-8e9c-4b1a-950f-d60fabe27176'
const leaseToken = '9d3c1f0e-0a51-4f6c-9a43-5d1e2f3a4b5c'
const matchId = '4a6d0c55-2b0e-4f7e-9d1a-3c5b7e9f1a2b'
const auth = { authorization: `Bearer ${token}` }
const leased = { ...auth, 'x-art-lease': leaseToken }
const groupPath = `art/${'1'.repeat(32)}.json`

function routes(overrides: Partial<ReplayArtJobs> = {}) {
  const art: ReplayArtJobs = {
    queue: mock(async () => undefined),
    queueWarm: mock(async () => undefined),
    claim: mock(async () => null),
    missing: mock(async (_jobId: string, _leaseToken: string, paths: string[]) => paths),
    store: mock(async () => ({ status: 'stored' as const })),
    read: mock(async () => ({ status: 'not-found' as const })),
    complete: mock(async () => 'completed' as const),
    fail: mock(async () => true),
    renew: mock(async () => true),
    release: mock(async () => true),
    ...overrides,
  }

  const jobs = { art } as unknown as ReplayJobs

  return { app: createReplayWorkerRoutes({ jobs, token }), art }
}

function jsonRequest(body: unknown, headers: Record<string, string> = leased) {
  return { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

const report = { build: 'dev-1', patches: ['11.00'], artFormat: 3 }

describe('replay worker art routes', () => {
  test('refuse a request without the bearer token', async () => {
    const { app, art } = routes()

    const response = await app.request('/art/claim', jsonRequest(report, { authorization: 'Bearer wrong' }))

    expect(response.status).toBe(401)
    expect(art.claim).not.toHaveBeenCalled()
  })

  test('a claim answers 204 when there is no art job', async () => {
    const { app, art } = routes()

    const response = await app.request('/art/claim', jsonRequest(report, auth))

    expect(response.status).toBe(204)
    expect(art.claim).toHaveBeenCalledWith(report)
  })

  test('a claim of a match job returns its gzipped line with the job in headers', async () => {
    const line = Bun.gzipSync(new TextEncoder().encode('{"exit":0}'))
    const job: ClaimedArtJob = { jobId, leaseToken, kind: 'match', patch: '11.00', matchId, line }
    const { app } = routes({ claim: mock(async () => job) })

    const response = await app.request('/art/claim', jsonRequest(report, auth))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-art-job')).toBe(jobId)
    expect(response.headers.get('x-art-lease')).toBe(leaseToken)
    expect(response.headers.get('x-art-kind')).toBe('match')
    expect(response.headers.get('x-art-patch')).toBe('11.00')
    expect(response.headers.get('x-art-match')).toBe(matchId)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(line))
  })

  test('a claim of a warm job has no body and no match', async () => {
    const job: ClaimedArtJob = { jobId, leaseToken, kind: 'warm', patch: '11.00', matchId: null, line: null }
    const { app } = routes({ claim: mock(async () => job) })

    const response = await app.request('/art/claim', jsonRequest(report, auth))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-art-kind')).toBe('warm')
    expect(response.headers.has('x-art-match')).toBe(false)
    expect((await response.arrayBuffer()).byteLength).toBe(0)
  })

  test('missing answers the paths the bucket lacks', async () => {
    const { app, art } = routes({ missing: mock(async () => [groupPath]) })

    const response = await app.request(`/art/${jobId}/missing`, jsonRequest({ paths: [groupPath, 'sheets/x.webp'] }))

    expect(await response.json()).toEqual({ missing: [groupPath] })
    expect(art.missing).toHaveBeenCalledWith(jobId, leaseToken, [groupPath, 'sheets/x.webp'])
  })

  test('missing answers 409 once the lease is lost, and 400 without one', async () => {
    const { app } = routes({ missing: mock(async () => 'lease-lost' as const) })

    expect((await app.request(`/art/${jobId}/missing`, jsonRequest({ paths: [] }))).status).toBe(409)
    expect((await app.request(`/art/${jobId}/missing`, jsonRequest({ paths: [] }, auth))).status).toBe(400)
  })

  test('missing with more paths than one call may ask about is refused', async () => {
    const { app, art } = routes()
    const paths = Array.from({ length: 2001 }, () => groupPath)

    const response = await app.request(`/art/${jobId}/missing`, jsonRequest({ paths }))

    expect(response.status).toBe(400)
    expect(art.missing).not.toHaveBeenCalled()
  })

  test('a file arrives raw and reaches the art jobs', async () => {
    const { app, art } = routes()
    const bytes = new TextEncoder().encode('{"pieces":[]}')

    const response = await app.request(`/art/${jobId}/files/${groupPath}`, {
      method: 'PUT',
      headers: leased,
      body: bytes,
    })

    expect(response.status).toBe(204)
    expect(art.store).toHaveBeenCalledWith(jobId, leaseToken, groupPath, bytes)
  })

  test('a file under a path outside the art layout is refused before it is read', async () => {
    const { app, art } = routes()

    const response = await app.request(`/art/${jobId}/files/matches/x/manifest.json`, {
      method: 'PUT',
      headers: leased,
      body: '{}',
    })

    expect(response.status).toBe(422)
    expect(art.store).not.toHaveBeenCalled()
  })

  test('a file the check rejects answers 422 with the reason', async () => {
    const { app } = routes({ store: mock(async () => ({ status: 'rejected' as const, reason: 'not valid json' })) })

    const response = await app.request(`/art/${jobId}/files/${groupPath}`, {
      method: 'PUT',
      headers: leased,
      body: 'x',
    })

    expect(response.status).toBe(422)
    expect(await response.text()).toBe('not valid json')
  })

  test('a file over 8 MiB is refused', async () => {
    const { app, art } = routes()

    const response = await app.request(`/art/${jobId}/files/${groupPath}`, {
      method: 'PUT',
      headers: leased,
      body: new Uint8Array(8 * 1024 * 1024 + 1),
    })

    expect(response.status).toBe(413)
    expect(art.store).not.toHaveBeenCalled()
  })

  test('a stored art group can be read back, and an absent one answers 404', async () => {
    const bytes = new TextEncoder().encode('{"pieces":[]}')

    const read = mock(async (_jobId: string, _leaseToken: string, path: string) =>
      path === groupPath ? { status: 'found' as const, bytes } : { status: 'not-found' as const },
    )

    const { app } = routes({ read })

    const found = await app.request(`/art/${jobId}/files/${groupPath}`, { headers: leased })
    const absent = await app.request(`/art/${jobId}/files/art/${'2'.repeat(32)}.json`, { headers: leased })

    expect(found.status).toBe(200)
    expect(found.headers.get('content-type')).toBe('application/json')
    expect(new Uint8Array(await found.arrayBuffer())).toEqual(bytes)
    expect(absent.status).toBe(404)
  })

  test('a read needs the lease, and only hands out art groups and map files', async () => {
    const { app, art } = routes({ read: mock(async () => ({ status: 'refused' as const, reason: 'a sheet' })) })

    const unleased = await app.request(`/art/${jobId}/files/${groupPath}`, { headers: auth })
    const sheet = await app.request(`/art/${jobId}/files/sheets/0123456789abcdef.webp`, { headers: leased })

    expect(unleased.status).toBe(400)
    expect(sheet.status).toBe(422)
    expect(art.read).toHaveBeenCalledTimes(1)
  })

  test('the result goes through to completeArtJob', async () => {
    const { app, art } = routes()

    const result = {
      manifest: { format: 3 },
      maps: [{ patch: '11.00', mapId: 136, path: 'maps/x.json' }],
      artFormat: 3,
    }

    const response = await app.request(`/art/${jobId}/result`, jsonRequest(result))

    expect(response.status).toBe(204)
    expect(art.complete).toHaveBeenCalledWith(jobId, leaseToken, result)
  })

  test('a warm result has no manifest', async () => {
    const { app, art } = routes()

    const response = await app.request(`/art/${jobId}/result`, jsonRequest({ manifest: null, maps: [], artFormat: 3 }))

    expect(response.status).toBe(204)
    expect(art.complete).toHaveBeenCalledWith(jobId, leaseToken, { manifest: null, maps: [], artFormat: 3 })
  })

  test('a result the art jobs refuse answers 422, and one after the lease was lost 409', async () => {
    const result = { manifest: null, maps: [], artFormat: 3 }
    const refused = routes({ complete: mock(async () => 'failed' as const) })
    const late = routes({ complete: mock(async () => 'lease-lost' as const) })

    expect((await refused.app.request(`/art/${jobId}/result`, jsonRequest(result))).status).toBe(422)
    expect((await late.app.request(`/art/${jobId}/result`, jsonRequest(result))).status).toBe(409)
  })

  test('a result without an art format is refused', async () => {
    const { app, art } = routes()

    const response = await app.request(`/art/${jobId}/result`, jsonRequest({ manifest: null, maps: [] }))

    expect(response.status).toBe(400)
    expect(art.complete).not.toHaveBeenCalled()
  })

  test('a failure reaches the art jobs, and one with an unknown code is refused', async () => {
    const { app, art } = routes()

    const known = await app.request(`/art/${jobId}/failure`, jsonRequest({ code: 'no-animations', message: 'x' }))
    const unknown = await app.request(`/art/${jobId}/failure`, jsonRequest({ code: 'game-error', message: 'x' }))

    expect(known.status).toBe(204)
    expect(unknown.status).toBe(400)
    expect(art.fail).toHaveBeenCalledWith(jobId, leaseToken, { code: 'no-animations', message: 'x' })
  })

  test('renew answers 409 when the lease is gone', async () => {
    const { app } = routes({ renew: mock(async () => false) })

    const response = await app.request(`/art/${jobId}/renew`, { method: 'POST', headers: leased })

    expect(response.status).toBe(409)
  })
})
