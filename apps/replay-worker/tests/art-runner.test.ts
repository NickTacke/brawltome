import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArtClient } from '../src/art-client'
import { createExporter, type Exporter } from '../src/art-export'
import { ArtRunner, type ArtRunnerDeps } from '../src/art-runner'
import { fakeGroups, fakeMap, fakeMapId, fakePack, fakeSheet, warmGroup, warmMaps } from './fake-export'

const token = 'replay-worker-token-for-tests-32-bytes-long'
const jobId = '1b2f7508-8e9c-4b1a-950f-d60fabe27176'
const leaseToken = '9d3c1f0e-0a51-4f6c-9a43-5d1e2f3a4b5c'
const matchId = '4a6d0c55-2b0e-4f7e-9d1a-3c5b7e9f1a2b'
const fakeExport = ['bun', join(import.meta.dir, 'fake-export.ts')]

type NextJob = { kind: 'match'; fake: string } | { kind: 'warm'; patch?: string }

type Received = {
  calls: string[]
  claims: unknown[]
  puts: string[]
  results: { manifest: unknown; maps: unknown[]; artFormat: number }[]
  failures: { code: string; message: string }[]
  renewals: number
  authorizations: string[]
}

describe('the art runner', () => {
  let root: string
  let server: ReturnType<typeof Bun.serve>
  let nextJob: NextJob | null
  // the art bucket, as the api's missing and files routes see it
  let bucket: Map<string, Uint8Array>
  let received: Received

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'replay-worker-art-'))
    mkdirSync(join(root, 'games', '11.00'), { recursive: true })
    // the fake export's warm never ends for this patch
    mkdirSync(join(root, 'games', '11.01'), { recursive: true })
    mkdirSync(join(root, 'work'))

    server = Bun.serve({ port: 0, fetch: (request) => answer(request) })
  })

  afterAll(() => {
    server?.stop(true)
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    nextJob = null
    bucket = new Map()
    received = { calls: [], claims: [], puts: [], results: [], failures: [], renewals: 0, authorizations: [] }
  })

  // the api's art routes, as far as the worker sees them
  async function answer(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.replace(`/internal/replays/art/`, '')
    const [first, action, ...rest] = path.split('/')

    received.authorizations.push(request.headers.get('authorization') ?? '')

    if (first === 'claim') return claimed(await request.json())

    expect(first).toBe(jobId)
    expect(request.headers.get('x-art-lease')).toBe(leaseToken)

    if (action === 'missing') return missing(await request.json())

    if (action === 'files' && request.method === 'GET') return fileOf(rest.join('/'))

    if (action === 'files') return stored(rest.join('/'), new Uint8Array(await request.arrayBuffer()))

    if (action === 'result') received.results.push(await request.json())

    if (action === 'failure') received.failures.push(await request.json())

    if (action === 'renew') received.renewals += 1

    received.calls.push(action ?? '')

    return new Response(null, { status: 204 })
  }

  function claimed(report: unknown): Response {
    received.calls.push('claim')
    received.claims.push(report)

    if (!nextJob) return new Response(null, { status: 204 })

    const job = nextJob

    const headers: Record<string, string> = {
      'x-art-job': jobId,
      'x-art-lease': leaseToken,
      'x-art-kind': job.kind,
      'x-art-patch': job.kind === 'warm' ? (job.patch ?? '11.00') : '11.00',
    }

    nextJob = null

    if (job.kind === 'warm') return new Response(null, { headers })

    const line = Bun.gzipSync(new TextEncoder().encode(`${JSON.stringify({ fake: job.fake })}\n`))

    return new Response(line, { headers: { ...headers, 'x-art-match': matchId } })
  }

  function missing(body: { paths: string[] }): Response {
    received.calls.push('missing')

    return Response.json({ missing: body.paths.filter((path) => !bucket.has(path)) })
  }

  function fileOf(path: string): Response {
    received.calls.push(`get ${path}`)

    const bytes = bucket.get(path)

    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 })
  }

  function stored(path: string, bytes: Uint8Array): Response {
    received.calls.push('put')
    received.puts.push(path)
    bucket.set(path, bytes)

    return new Response(null, { status: 204 })
  }

  // the export, its calls noted in order with the api's
  function recorded(exporter: Exporter): Exporter {
    return {
      run: (args, timeoutMs) => {
        received.calls.push(args[0] === 'warm' && args.includes('--list') ? 'warm --list' : (args[0] ?? ''))

        return exporter.run(args, timeoutMs)
      },
    }
  }

  function runner(overrides: Partial<ArtRunnerDeps> = {}): ArtRunner {
    const exporter = createExporter({ command: fakeExport })

    return new ArtRunner({
      art: createArtClient({ apiUrl: `http://localhost:${server.port}`, token }),
      pool: {
        report: () => ({ build: 'dev-test', patches: ['11.00'] }),
        limitTo: async (count) => {
          received.calls.push(`limit ${count}`)
        },
        unlimit: () => {
          received.calls.push('unlimit')
        },
      },
      exporter: recorded(exporter),
      gameRoot: join(root, 'games'),
      workDir: join(root, 'work'),
      artFormat: 3,
      processesDuringArt: 1,
      renewEveryMs: 60_000,
      exportTimeoutMs: 10_000,
      warmTimeoutMs: 10_000,
      ...overrides,
    })
  }

  function storedJson(path: string, value: unknown): void {
    bucket.set(path, new TextEncoder().encode(JSON.stringify(value)))
  }

  test('exports a match: it plans, asks, renders only what is missing, sends it, then the manifest', async () => {
    const [presentGroup, newGroup] = fakeGroups as [string, string]

    storedJson(presentGroup, { sheets: [] })

    nextJob = { kind: 'match', fake: 'ok' }

    expect(await runner().runOnce()).toBe('done')

    expect(received.calls).toEqual([
      'claim',
      'plan',
      'missing',
      `get ${presentGroup}`,
      'limit 1',
      'render',
      'unlimit',
      'missing',
      ...received.puts.map(() => 'put'),
      'result',
    ])

    const expectedPuts = [newGroup, fakeSheet(newGroup).path, fakeMap, fakeSheet(fakeMap).path, fakePack().path]

    expect(received.puts.sort()).toEqual(expectedPuts.sort())

    expect(received.results).toEqual([
      {
        manifest: { format: 3, map: { layout: fakeMap }, art: fakeGroups },
        maps: [{ patch: '11.00', mapId: fakeMapId, path: fakeMap }],
        artFormat: 3,
      },
    ])

    expect(received.claims).toEqual([{ build: 'dev-test', patches: ['11.00'], artFormat: 3 }])
    expect(received.authorizations.every((value) => value === `Bearer ${token}`)).toBe(true)
  })

  test('only files the art bucket lacks are sent', async () => {
    const sharedSheet = fakeSheet(fakeMap)

    // the map's sheet came with another match; the map file itself didn't
    bucket.set(sharedSheet.path, sharedSheet.bytes)
    nextJob = { kind: 'match', fake: 'ok' }

    await runner().runOnce()

    expect(received.puts).not.toContain(sharedSheet.path)
    expect(received.puts).toContain(fakeMap)
    expect(received.results).toHaveLength(1)
  })

  test('a line without animations reports no-animations and renders nothing', async () => {
    nextJob = { kind: 'match', fake: 'no-animations' }

    await runner().runOnce()

    expect(received.calls).toEqual(['claim', 'plan', 'failure'])
    expect(received.failures).toEqual([{ code: 'no-animations', message: 'no animations in the line' }])
  })

  test('a failed render reports export-failed, and the pool is unlimited after it', async () => {
    nextJob = { kind: 'match', fake: 'crash-render' }

    await runner().runOnce()

    expect(received.calls.slice(-4)).toEqual(['limit 1', 'render', 'unlimit', 'failure'])
    expect(received.failures).toEqual([{ code: 'export-failed', message: expect.stringContaining('boom') }])
  })

  test('a render past its timeout reports export-failed, and the pool is unlimited after it', async () => {
    nextJob = { kind: 'match', fake: 'hang-render' }

    await runner({ exportTimeoutMs: 500, warmTimeoutMs: 60_000 }).runOnce()

    expect(received.calls.slice(-4)).toEqual(['limit 1', 'render', 'unlimit', 'failure'])
    expect(received.failures).toEqual([{ code: 'export-failed', message: expect.stringContaining('500 ms') }])
  })

  test('the pool is unlimited even when the render throws, and the job fails with worker-error', async () => {
    const real = createExporter({ command: fakeExport })

    const throwing: Exporter = {
      run: async (args, timeoutMs) => {
        if (args[0] === 'render') throw new Error('spawn failed')

        return real.run(args, timeoutMs)
      },
    }

    nextJob = { kind: 'match', fake: 'ok' }

    await runner({ exporter: throwing }).runOnce()

    expect(received.calls.slice(-3)).toEqual(['limit 1', 'unlimit', 'failure'])
    expect(received.failures).toEqual([{ code: 'worker-error', message: expect.stringContaining('spawn failed') }])
  })

  test('renews the lease while the export runs', async () => {
    nextJob = { kind: 'match', fake: 'hang-render' }

    await runner({ renewEveryMs: 100, exportTimeoutMs: 500 }).runOnce()

    expect(received.renewals).toBeGreaterThanOrEqual(2)
  })

  test('warms a patch: lists, asks, warms only what is missing, sends it, then every map of the patch', async () => {
    const [presentMap, newMap] = warmMaps as [string, string]

    storedJson(presentMap, { mapId: 6, patch: '11.00' })
    nextJob = { kind: 'warm' }

    await runner().runOnce()

    expect(received.calls).toEqual([
      'claim',
      'warm --list',
      'missing',
      `get ${presentMap}`,
      'limit 1',
      'warm',
      'unlimit',
      'missing',
      ...received.puts.map(() => 'put'),
      'result',
    ])

    expect(received.puts.sort()).toEqual([warmGroup, fakeSheet(warmGroup).path, newMap, fakeSheet(newMap).path].sort())

    expect(received.results).toEqual([
      {
        manifest: null,
        maps: expect.arrayContaining([
          { patch: '11.00', mapId: 6, path: presentMap },
          { patch: '11.00', mapId: 7, path: newMap },
        ]),
        artFormat: 3,
      },
    ])
  })

  test('a warm runs under its own timeout, not the one for a match', async () => {
    nextJob = { kind: 'warm', patch: '11.01' }

    await runner({ exportTimeoutMs: 60_000, warmTimeoutMs: 500 }).runOnce()

    expect(received.calls.slice(-4)).toEqual(['limit 1', 'warm', 'unlimit', 'failure'])
    expect(received.failures).toEqual([{ code: 'export-failed', message: expect.stringContaining('500 ms') }])
  })

  test('a job for a patch the worker has no game folder for reports export-failed', async () => {
    nextJob = { kind: 'warm' }

    await runner({ gameRoot: join(root, 'nowhere') }).runOnce()

    expect(received.failures).toEqual([{ code: 'export-failed', message: expect.stringContaining('11.00') }])
  })

  test('is idle when there is no job, and leaves no files behind', async () => {
    nextJob = { kind: 'match', fake: 'ok' }

    await runner().runOnce()

    expect(await runner().runOnce()).toBe('idle')
    expect(readdirSync(join(root, 'work', 'art'))).toEqual([])
  })
})
