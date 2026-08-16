import { describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import type { ReplayAnalysisJobs } from '@brawltome/replay-analysis'
import { createReplayAnalysisRoutes, createReplayBridgeRoutes } from '../src/routes/replay-analysis.routes'

const accountId = 'f00efdc1-5cbd-44c7-a2ac-47f98f1c0f39'
const jobId = '1b2f7508-8e9c-4b1a-950f-d60fabe27176'
const leaseToken = randomUUID()

function dependencies() {
  const create = mock(async () => ({
    id: jobId,
    status: 'pending' as const,
    fileName: 'match.replay',
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
    failure: null,
  }))
  const accounts = {
    authenticate: mock(async () => ({
      status: 'signedIn' as const,
      extended: false,
      account: { id: accountId, displayName: 'Player', avatarUrl: null, createdAt: new Date() },
    })),
  } as unknown as Accounts
  const jobs = { create } as unknown as ReplayAnalysisJobs
  return { accounts, jobs, create }
}

describe('replay upload routes', () => {
  test('requires the web origin and authenticated session before storing bounded bytes', async () => {
    const deps = dependencies()
    const app = createReplayAnalysisRoutes({ ...deps, webOrigin: 'https://brawltome.app' })

    const forbidden = await app.request('/replays', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Uint8Array.of(1),
    })
    expect(forbidden.status).toBe(403)
    expect(deps.create).not.toHaveBeenCalled()

    const accepted = await app.request('/replays', {
      method: 'POST',
      headers: {
        cookie: 'brawltome_session=session-token',
        origin: 'https://brawltome.app',
        'content-type': 'application/octet-stream',
        'x-replay-file-name': 'match.replay',
      },
      body: Uint8Array.of(1, 2, 3),
    })
    expect(accepted.status).toBe(202)
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        fileName: 'match.replay',
        replayBytes: Uint8Array.of(1, 2, 3),
      }),
    )
  })

  test('rejects a declared oversized replay without reading it', async () => {
    const deps = dependencies()
    const app = createReplayAnalysisRoutes({ ...deps, webOrigin: 'https://brawltome.app' })
    const response = await app.request('/replays', {
      method: 'POST',
      headers: {
        cookie: 'brawltome_session=session-token',
        origin: 'https://brawltome.app',
        'content-type': 'application/octet-stream',
        'content-length': String(16 * 1024 * 1024 + 1),
      },
      body: Uint8Array.of(1),
    })
    expect(response.status).toBe(413)
    expect(deps.create).not.toHaveBeenCalled()
  })
})

describe('replay bridge routes', () => {
  test('returns and requires the lease fence for state transitions', async () => {
    const claim = mock(async () => ({
      id: jobId,
      leaseToken,
      replayBytes: Uint8Array.of(1, 2, 3),
      replayDigest: `sha256:${'a'.repeat(64)}`,
    }))
    const release = mock(async (_id: string, token: string) => token === leaseToken)
    const renew = mock(async (_id: string, token: string) => token === leaseToken)
    const jobs = { claim, release, renew } as unknown as ReplayAnalysisJobs
    const secret = 'bridge-secret-that-is-at-least-32-bytes'
    const app = createReplayBridgeRoutes({ jobs, secret })

    const claimed = await app.request('/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(claimed.status).toBe(200)
    expect(claimed.headers.get('x-replay-lease-seconds')).toBe('600')
    expect(claimed.headers.get('x-replay-lease-token')).toBe(leaseToken)
    expect(new Uint8Array(await claimed.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))

    const renewed = await app.request(`/${jobId}/renew`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'x-replay-lease-token': leaseToken },
    })
    expect(renewed.status).toBe(204)
    expect(renew).toHaveBeenCalledWith(jobId, leaseToken, 600)

    const staleRelease = await app.request(`/${jobId}/release`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'x-replay-lease-token': '11111111-1111-4111-8111-111111111111',
      },
    })
    expect(staleRelease.status).toBe(409)

    const currentRelease = await app.request(`/${jobId}/release`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'x-replay-lease-token': leaseToken },
    })
    expect(currentRelease.status).toBe(204)
    expect(release).toHaveBeenLastCalledWith(jobId, leaseToken)
  })
})
