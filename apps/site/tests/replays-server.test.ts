import { describe, expect, mock, test } from 'bun:test'
import type { ReplayUploadResultContract } from '@brawltome/contracts'
import { loadMatch, serveReplayFile, uploadForVisitor } from '../src/server/replay-data'
import { apiUrl, useApiSettings } from './api-stub'

type Call = { path: string; method: string; headers: Headers; body: BodyInit | null | undefined }

function stubApi(answer: (path: string) => Response): Call[] {
  const calls: Call[] = []

  globalThis.fetch = mock(async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input).replace(`${apiUrl}/v1`, '')

    calls.push({ path, method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body })

    return answer(path)
  }) as unknown as typeof fetch

  return calls
}

const replay = () => new File([Uint8Array.of(0x78, 0xda, 1)], '[11.00] BigCrystalTemple.replay')
const signedIn = { session: { token: 'raw-session-token', drop: () => undefined }, isSameOrigin: true }

const outcome: ReplayUploadResultContract['outcomes'][number] = {
  uploadId: null,
  fileName: 'x.replay',
  status: 'queued',
  matchId: null,
  rejection: null,
}

const matchDetail = {
  id: '6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f',
  patch: '11.00',
  mapName: 'Big Crystal Temple',
  modeName: 'Stock',
  isRanked: true,
  isCustom: false,
  durationMs: 180000,
  parsedAt: '2026-11-13T20:00:00.000Z',
  queue: 'ranked',
  hasTeams: false,
  hasTeamDamage: false,
  stocks: 3,
  isReliable: true,
  failedChecks: [],
  players: [],
  replay: { available: true, patch: '11.00', fileName: '[11.00] BigCrystalTemple.replay' },
}

describe('uploading replays for a visitor', () => {
  useApiSettings()

  test('forwards the files as multipart with the session and the internal secret', async () => {
    const calls = stubApi(() => Response.json({ outcomes: [outcome] }))

    const answer = await uploadForVisitor([replay()], signedIn)

    expect(answer).toEqual({ kind: 'uploaded', outcomes: [outcome] })
    expect(calls[0]?.path).toBe('/replays')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.get('x-visitor-session')).toBe('raw-session-token')
    expect(calls[0]?.headers.get('x-internal-secret')).toBe('test-internal-secret')
    expect((calls[0]?.body as FormData | undefined)?.get('files[0]')).toBeInstanceOf(File)
  })

  test('refuses a request from another site without calling the api', async () => {
    const calls = stubApi(() => Response.json({ outcomes: [] }))

    expect(await uploadForVisitor([replay()], { ...signedIn, isSameOrigin: false })).toEqual({ kind: 'failed' })
    expect(calls).toEqual([])
  })

  test('a signed-out visitor is told to sign in', async () => {
    stubApi(() => Response.json({ outcomes: [] }))

    expect(
      await uploadForVisitor([replay()], { ...signedIn, session: { token: undefined, drop: () => undefined } }),
    ).toEqual({
      kind: 'signedOut',
    })
  })

  test('an account without a verified player is told to link Steam', async () => {
    stubApi(() => new Response(JSON.stringify({ code: 'FORBIDDEN' }), { status: 403 }))

    expect(await uploadForVisitor([replay()], signedIn)).toEqual({ kind: 'notVerified' })
  })
})

describe('reading matches', () => {
  useApiSettings()

  test('an unknown match is null', async () => {
    stubApi(() => new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }))

    expect(await loadMatch(matchDetail.id)).toBeNull()
  })

  test('a match is read and checked', async () => {
    stubApi(() => Response.json(matchDetail))

    expect(await loadMatch(matchDetail.id)).toEqual(matchDetail)
  })

  test('the replay file is passed through with its name, and 410 once it is gone', async () => {
    stubApi((path) =>
      path.endsWith('/replay')
        ? new Response(Uint8Array.of(0x78, 0xda), {
            headers: { 'content-disposition': 'attachment; filename="[11.00] BigCrystalTemple.replay"' },
          })
        : Response.json({}),
    )

    const file = await serveReplayFile(matchDetail.id)

    expect(file.status).toBe(200)
    expect(file.headers.get('content-disposition')).toContain('[11.00] BigCrystalTemple.replay')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(Uint8Array.of(0x78, 0xda))

    stubApi(() => new Response(JSON.stringify({ code: 'GONE' }), { status: 410 }))

    expect((await serveReplayFile(matchDetail.id)).status).toBe(410)
  })
})
