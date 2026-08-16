import { describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { type ReplayBridgeConfig, processNextReplay } from '../src/index'

const leaseToken = randomUUID()

const config: ReplayBridgeConfig = {
  brawltomeUrl: 'https://api.brawltome.test',
  brawltomeToken: 'upstream-token',
  processorUrl: 'http://127.0.0.1:8080',
  processorToken: 'processor-token',
  pollMs: 100,
}

describe('replay bridge', () => {
  test('claims, submits, polls, returns, and deletes one replay', async () => {
    const requests: Request[] = []
    const responses = [
      new Response(Uint8Array.of(1, 2, 3), {
        status: 200,
        headers: {
          'x-replay-job-id': '1b2f7508-8e9c-4b1a-950f-d60fabe27176',
          'x-replay-lease-seconds': '600',
          'x-replay-lease-token': leaseToken,
        },
      }),
      Response.json(
        {
          apiVersion: 1,
          state: 'running',
          jobId: 'processor-job-0001',
          statusUrl: '/v1/jobs/processor-job-0001',
          submittedAt: '2026-08-16T10:00:00Z',
          startedAt: '2026-08-16T10:00:00Z',
        },
        { status: 202 },
      ),
      Response.json({
        apiVersion: 1,
        state: 'succeeded',
        jobId: 'processor-job-0001',
        statusUrl: '/v1/jobs/processor-job-0001',
        resultUrl: '/v1/jobs/processor-job-0001/result',
        submittedAt: '2026-08-16T10:00:00Z',
        terminalAt: '2026-08-16T10:01:00Z',
        expiresAt: '2026-08-16T11:01:00Z',
      }),
      Response.json({ schemaVersion: 1 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]
    const fetcher = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    }) as unknown as typeof fetch

    expect(await processNextReplay(config, fetcher, async () => undefined)).toBe(true)
    expect(requests.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
      'POST /internal/replays/claim',
      'POST /v1/jobs',
      'GET /v1/jobs/processor-job-0001',
      'GET /v1/jobs/processor-job-0001/result',
      'POST /internal/replays/1b2f7508-8e9c-4b1a-950f-d60fabe27176/result',
      'DELETE /v1/jobs/processor-job-0001',
    ])
    const submission = requests[1]
    expect(submission?.headers.get('idempotency-key')).toBe(`1b2f7508-8e9c-4b1a-950f-d60fabe27176:${leaseToken}:1`)
    expect(requests[4]?.headers.get('x-replay-lease-token')).toBe(leaseToken)
    if (!submission) throw new Error('Replay was not submitted')
    expect(new Uint8Array(await submission.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
  })

  test('rejects processor-controlled absolute URLs and releases the fenced claim', async () => {
    const requests: Request[] = []
    const responses = [
      new Response(Uint8Array.of(1), {
        status: 200,
        headers: {
          'x-replay-job-id': '1b2f7508-8e9c-4b1a-950f-d60fabe27176',
          'x-replay-lease-seconds': '600',
          'x-replay-lease-token': leaseToken,
        },
      }),
      Response.json(
        {
          apiVersion: 1,
          state: 'running',
          jobId: 'processor-job-0001',
          statusUrl: 'https://attacker.test/steal-token',
          submittedAt: '2026-08-16T10:00:00Z',
          startedAt: '2026-08-16T10:00:00Z',
        },
        { status: 202 },
      ),
      new Response(null, { status: 204 }),
    ]
    const fetcher = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    }) as unknown as typeof fetch

    await expect(processNextReplay(config, fetcher, async () => undefined)).rejects.toThrow('invalid job')
    expect(requests.map(({ url }) => new URL(url).hostname)).toEqual([
      'api.brawltome.test',
      '127.0.0.1',
      'api.brawltome.test',
    ])
    expect(new URL(requests[2]?.url ?? '').pathname).toContain('/release')
  })

  test('uses a new idempotency key when a transient failure requires a new job', async () => {
    const requests: Request[] = []
    const base = {
      apiVersion: 1,
      jobId: 'processor-job-0001',
      statusUrl: '/v1/jobs/processor-job-0001',
      submittedAt: '2026-08-16T10:00:00Z',
    }
    const responses = [
      new Response(Uint8Array.of(1), {
        status: 200,
        headers: {
          'x-replay-job-id': '1b2f7508-8e9c-4b1a-950f-d60fabe27176',
          'x-replay-lease-seconds': '600',
          'x-replay-lease-token': leaseToken,
        },
      }),
      Response.json(
        {
          ...base,
          state: 'failed',
          terminalAt: '2026-08-16T10:01:00Z',
          expiresAt: '2026-08-16T11:01:00Z',
          failure: {
            failureSchemaVersion: 1,
            class: 'transient',
            action: 'submit_new_job',
            code: 'worker.interrupted',
            message: 'Worker restarted',
            occurredAt: '2026-08-16T10:01:00Z',
          },
        },
        { status: 202 },
      ),
      new Response(null, { status: 204 }),
      Response.json(
        {
          ...base,
          jobId: 'processor-job-0002',
          statusUrl: '/v1/jobs/processor-job-0002',
          state: 'succeeded',
          resultUrl: '/v1/jobs/processor-job-0002/result',
          terminalAt: '2026-08-16T10:02:00Z',
          expiresAt: '2026-08-16T11:02:00Z',
        },
        { status: 202 },
      ),
      Response.json({ schemaVersion: 1 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]
    const fetcher = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    }) as unknown as typeof fetch

    expect(await processNextReplay(config, fetcher, async () => undefined)).toBe(true)
    const submissions = requests.filter(({ method, url }) => method === 'POST' && url.endsWith('/v1/jobs'))
    expect(submissions).toHaveLength(2)
    expect(submissions[0]?.headers.get('idempotency-key')).not.toBe(submissions[1]?.headers.get('idempotency-key'))
  })

  test('releases blocked work for retry after operator recovery', async () => {
    const requests: Request[] = []
    const responses = [
      new Response(Uint8Array.of(1), {
        status: 200,
        headers: {
          'x-replay-job-id': '1b2f7508-8e9c-4b1a-950f-d60fabe27176',
          'x-replay-lease-seconds': '600',
          'x-replay-lease-token': leaseToken,
        },
      }),
      Response.json(
        {
          failureSchemaVersion: 1,
          class: 'blocked',
          action: 'operator_recovery',
          code: 'state.recovery_required',
          message: 'Operator recovery is required',
          occurredAt: '2026-08-16T10:01:00Z',
        },
        { status: 503 },
      ),
      new Response(null, { status: 204 }),
    ]
    const fetcher = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    }) as unknown as typeof fetch

    expect(await processNextReplay(config, fetcher, async () => undefined)).toBe(true)
    expect(new URL(requests[2]?.url ?? '').pathname).toContain('/release')
    expect(requests.some(({ url }) => url.includes('/failure'))).toBe(false)
  })

  test('renews a running processor job before its Brawltome lease expires', async () => {
    const requests: Request[] = []
    const responses = [
      new Response(Uint8Array.of(1), {
        status: 200,
        headers: {
          'x-replay-job-id': '1b2f7508-8e9c-4b1a-950f-d60fabe27176',
          'x-replay-lease-seconds': '600',
          'x-replay-lease-token': leaseToken,
        },
      }),
      Response.json(
        {
          apiVersion: 1,
          state: 'running',
          jobId: 'processor-job-0001',
          statusUrl: '/v1/jobs/processor-job-0001',
          submittedAt: '2026-08-16T10:00:00Z',
          startedAt: '2026-08-16T10:00:00Z',
        },
        { status: 202 },
      ),
      new Response(null, { status: 204 }),
      Response.json({
        apiVersion: 1,
        state: 'succeeded',
        jobId: 'processor-job-0001',
        statusUrl: '/v1/jobs/processor-job-0001',
        resultUrl: '/v1/jobs/processor-job-0001/result',
        submittedAt: '2026-08-16T10:00:00Z',
        terminalAt: '2026-08-16T10:01:00Z',
        expiresAt: '2026-08-16T11:01:00Z',
      }),
      Response.json({ schemaVersion: 1 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]
    const fetcher = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    }) as unknown as typeof fetch
    const times = [0, 0, 300_000, 300_000, 300_000, 300_000]

    expect(
      await processNextReplay(
        config,
        fetcher,
        async () => undefined,
        () => times.shift() ?? 300_000,
      ),
    ).toBe(true)
    expect(requests.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
      'POST /internal/replays/claim',
      'POST /v1/jobs',
      'POST /internal/replays/1b2f7508-8e9c-4b1a-950f-d60fabe27176/renew',
      'GET /v1/jobs/processor-job-0001',
      'GET /v1/jobs/processor-job-0001/result',
      'POST /internal/replays/1b2f7508-8e9c-4b1a-950f-d60fabe27176/result',
      'DELETE /v1/jobs/processor-job-0001',
    ])
  })

  test('renews before long result transfer and callback phases', async () => {
    const requests: Request[] = []
    const signals: AbortSignal[] = []
    const succeeded = {
      apiVersion: 1,
      state: 'succeeded',
      jobId: 'processor-job-0001',
      statusUrl: '/v1/jobs/processor-job-0001',
      resultUrl: '/v1/jobs/processor-job-0001/result',
      submittedAt: '2026-08-16T10:00:00Z',
      terminalAt: '2026-08-16T10:01:00Z',
      expiresAt: '2026-08-16T11:01:00Z',
    }
    const responses = [
      new Response(Uint8Array.of(1), {
        status: 200,
        headers: {
          'x-replay-job-id': '1b2f7508-8e9c-4b1a-950f-d60fabe27176',
          'x-replay-lease-seconds': '600',
          'x-replay-lease-token': leaseToken,
        },
      }),
      Response.json(succeeded, { status: 202 }),
      new Response(null, { status: 204 }),
      Response.json({ schemaVersion: 1 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]
    const fetcher = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      if (init?.signal) signals.push(init.signal)
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response
    }) as unknown as typeof fetch
    const times = [0, 0, 300_000, 300_000, 600_000, 600_000]

    expect(
      await processNextReplay(
        config,
        fetcher,
        async () => undefined,
        () => times.shift() ?? 600_000,
      ),
    ).toBe(true)
    expect(signals).toHaveLength(requests.length)
    expect(requests.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
      'POST /internal/replays/claim',
      'POST /v1/jobs',
      'POST /internal/replays/1b2f7508-8e9c-4b1a-950f-d60fabe27176/renew',
      'GET /v1/jobs/processor-job-0001/result',
      'POST /internal/replays/1b2f7508-8e9c-4b1a-950f-d60fabe27176/renew',
      'POST /internal/replays/1b2f7508-8e9c-4b1a-950f-d60fabe27176/result',
      'DELETE /v1/jobs/processor-job-0001',
    ])
  })
})
