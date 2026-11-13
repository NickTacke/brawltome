import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiClient } from '../src/api-client'
import { ProcessPool } from '../src/process-pool'
import { runOnce } from '../src/worker'

const token = 'replay-worker-token-for-tests-32-bytes-long'
const jobId = '1b2f7508-8e9c-4b1a-950f-d60fabe27176'
const leaseToken = '9d3c1f0e-0a51-4f6c-9a43-5d1e2f3a4b5c'

type Received = {
  results: string[]
  failures: { code: string; message: string }[]
  renewals: number
  authorizations: string[]
}

describe('the replay worker', () => {
  let root: string
  let pool: ProcessPool
  let server: ReturnType<typeof Bun.serve>
  let nextReplay: string | null
  let received: Received

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'replay-worker-loop-'))
    mkdirSync(join(root, 'games', '11.00'), { recursive: true })
    mkdirSync(join(root, 'work'))

    pool = await ProcessPool.start({
      command: ['bun', join(import.meta.dir, 'fake-bhnative.ts')],
      gameRoot: join(root, 'games'),
      newestProcesses: 1,
      previousProcesses: 0,
      build: 'dev-test',
      replayTimeoutMs: 5000,
      restartDelayMs: 100,
    })

    // the api's worker routes, as far as the worker sees them
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname

        received.authorizations.push(request.headers.get('authorization') ?? '')

        if (path.endsWith('/claim')) {
          if (nextReplay === null) return new Response(null, { status: 204 })

          const body = new TextEncoder().encode(nextReplay)

          nextReplay = null

          return new Response(body, {
            headers: {
              'x-replay-job': jobId,
              'x-replay-lease': leaseToken,
              'x-replay-kind': 'parse',
              'x-replay-digest': 'sha256:x',
            },
          })
        }

        if (path.endsWith('/result')) {
          received.results.push(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await request.arrayBuffer()))))
        }

        if (path.endsWith('/failure')) received.failures.push((await request.json()) as Received['failures'][number])

        if (path.endsWith('/renew')) received.renewals += 1

        return new Response(null, { status: 204 })
      },
    })
  })

  afterAll(async () => {
    server?.stop(true)
    pool?.close()
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    nextReplay = null
    received = { results: [], failures: [], renewals: 0, authorizations: [] }
  })

  function deps(renewEveryMs = 60_000) {
    return {
      api: createApiClient({ apiUrl: `http://localhost:${server.port}`, token }),
      pool,
      workDir: join(root, 'work'),
      renewEveryMs,
    }
  }

  test('posts the gzipped line of a replay it played', async () => {
    nextReplay = 'ok'

    expect(await runOnce(deps())).toBe('done')
    expect(received.results).toHaveLength(1)
    expect(JSON.parse(received.results[0] as string)).toMatchObject({ replay: `${jobId}.replay`, exit: 0 })
    expect(received.authorizations.every((value) => value === `Bearer ${token}`)).toBe(true)
  })

  test('posts patch-not-supported as a failure', async () => {
    nextReplay = 'old'

    await runOnce(deps())

    expect(received.results).toEqual([])
    expect(received.failures).toEqual([expect.objectContaining({ code: 'patch-not-supported' })])
  })

  test('renews the lease while a slow replay plays', async () => {
    nextReplay = 'slow'

    await runOnce(deps(200))

    expect(received.renewals).toBeGreaterThanOrEqual(2)
  })

  test('is idle when there is no job, and leaves no files behind', async () => {
    expect(await runOnce(deps())).toBe('idle')
    expect(readdirSync(join(root, 'work'))).toEqual([])
  })

  test('claims nothing while its bh-native processes are down', async () => {
    nextReplay = 'ok'

    const downPool = {
      isReady: () => false,
      report: () => pool.report(),
      play: () => pool.play(''),
    } as unknown as ProcessPool

    expect(await runOnce({ ...deps(), pool: downPool })).toBe('idle')
    expect(received.authorizations).toEqual([])
  })
})
