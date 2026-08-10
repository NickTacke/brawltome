import { describe, expect, test } from 'bun:test'
import {
  createJsonConsoleSink,
  createMemorySink,
  createTelemetry,
  parseTraceparent,
  renderPrometheus,
  requestContextFromHeaders,
} from '../src/index'

describe('telemetry foundation', () => {
  test('propagates deterministic request and trace context across asynchronous work', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({
      service: 'test',
      sink,
      now: () => 1_700_000_000_000,
      id: (() => {
        const ids = ['1'.repeat(32), '2'.repeat(16), '3'.repeat(32), '4'.repeat(16)]
        return () => ids.shift() ?? '5'.repeat(32)
      })(),
    })
    const context = requestContextFromHeaders(
      { 'x-request-id': 'request-123', traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` },
      telemetry.ids,
      { acceptIncoming: true },
    )

    await telemetry.run(context, async () => {
      await Promise.resolve()
      expect(telemetry.current()).toEqual(context)
      telemetry.logger.info('request.completed', { route: 'trpc' })
    })
    await telemetry.flush(50)

    expect(sink.records[0]).toMatchObject({
      timestamp: '2023-11-14T22:13:20.000Z',
      service: 'test',
      event: 'request.completed',
      requestId: 'request-123',
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
    })
  })

  test('replaces malformed context and rejects all-zero W3C identifiers', () => {
    const ids = { traceId: () => '1'.repeat(32), spanId: () => '2'.repeat(16), requestId: () => 'request-new' }
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${'1'.repeat(16)}-01`)).toBeNull()
    expect(requestContextFromHeaders({ 'x-request-id': 'contains spaces', traceparent: 'bad' }, ids)).toEqual({
      requestId: 'request-new',
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      sampled: true,
    })
  })

  test('redacts forbidden attributes and never recursively serializes arbitrary errors', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'test', sink, drainIntervalMs: 0 })
    const error = Object.assign(new Error('failed token=secret-value'), {
      authorization: 'Bearer secret',
      response: { body: 'private payload' },
    })

    telemetry.logger.error('source.failed', error, {
      api_key: 'secret',
      cookie: 'session=secret',
      operationId: 'safe-correlation-id',
      payload: 'private',
    })
    await telemetry.flush(50)

    expect(JSON.stringify(sink.records)).not.toContain('secret-value')
    expect(JSON.stringify(sink.records)).not.toContain('private payload')
    expect(sink.records[0]).toMatchObject({
      error: { name: 'Error', message: 'Operation failed' },
      attributes: { operationId: 'safe-correlation-id' },
    })
  })

  test('rejects nested, cyclic, non-finite, huge, and malicious runtime values deterministically', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'test', sink, drainIntervalMs: 0 })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const attributes: Record<string, unknown> = {
      safe: 'yes',
      nested: { private: true },
      cyclic,
      nan: Number.NaN,
      infinity: Number.POSITIVE_INFINITY,
      bool: true,
    }
    for (let index = 0; index < 10_000; index++) attributes[`extra${index}`] = `value${index}`
    const error = new Error('private')
    error.name = 'Bearer malicious-secret'

    telemetry.logger.error('adversarial', error, attributes)
    await telemetry.flush(50)

    expect(sink.records[0]?.attributes).toMatchObject({ safe: 'yes', bool: true })
    expect(Object.keys(sink.records[0]?.attributes ?? {})).toHaveLength(20)
    expect(sink.records[0]?.attributes).not.toHaveProperty('nested')
    expect(sink.records[0]?.attributes).not.toHaveProperty('cyclic')
    expect(sink.records[0]?.attributes).not.toHaveProperty('nan')
    expect(sink.records[0]?.attributes).not.toHaveProperty('infinity')
    expect(sink.records[0]?.error).toEqual({ name: 'Error', message: 'Operation failed' })
    expect(JSON.stringify(sink.records)).not.toContain('malicious-secret')
  })

  test('does not overlap exports when a sink ignores abort after timeout', async () => {
    let active = 0
    let maximumActive = 0
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const telemetry = createTelemetry({
      service: 'test',
      drainIntervalMs: 0,
      exportTimeoutMs: 5,
      sink: {
        export: async () => {
          active++
          maximumActive = Math.max(maximumActive, active)
          await blocked
          active--
        },
      },
    })

    telemetry.logger.info('one')
    await telemetry.flush(10)
    telemetry.logger.info('two')
    await telemetry.flush(10)
    expect(maximumActive).toBe(1)
    expect(telemetry.stats().exportFailures).toBe(1)
    release?.()
    await Bun.sleep(0)
    await telemetry.flush(20)
    expect(maximumActive).toBe(1)
  })

  test('JSON output honors backpressure and aborts a blocked drain', async () => {
    let signalObserved = false
    const sink = createJsonConsoleSink({
      write: () => false,
      waitForDrain: async (signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              signalObserved = true
              reject(new DOMException('aborted', 'AbortError'))
            },
            { once: true },
          )
        })
      },
    })
    const telemetry = createTelemetry({ service: 'test', sink, drainIntervalMs: 0, exportTimeoutMs: 5 })
    telemetry.logger.info('blocked')

    await telemetry.flush(20)

    expect(signalObserved).toBe(true)
    expect(telemetry.stats().exportFailures).toBe(1)
  })

  test('bounds queued records and isolates throwing sinks', async () => {
    const telemetry = createTelemetry({
      service: 'test',
      capacity: 2,
      drainIntervalMs: 0,
      sink: {
        export: async () => {
          throw new Error('offline')
        },
      },
    })

    expect(() => {
      telemetry.logger.info('one')
      telemetry.logger.info('two')
      telemetry.logger.info('three')
    }).not.toThrow()
    expect(telemetry.stats()).toEqual({ queued: 2, dropped: 1, exportFailures: 0, seriesDropped: 0 })
    await expect(telemetry.shutdown(10)).resolves.toBeUndefined()
    expect(telemetry.stats().exportFailures).toBe(1)
  })

  test('bridges local traces through the standard OpenTelemetry tracer interface', async () => {
    const observed: { name?: string; attributes?: unknown; ended?: boolean; status?: number } = {}
    const tracer = {
      startSpan(name: string, options: { attributes?: unknown }) {
        observed.name = name
        observed.attributes = options.attributes
        return {
          setStatus(status: { code: number }) {
            observed.status = status.code
            return this
          },
          recordException() {},
          end() {
            observed.ended = true
          },
        }
      },
    }
    const telemetry = createTelemetry({ service: 'test', drainIntervalMs: 0, tracer: tracer as never })

    await telemetry.trace('standard.span', { safe: true, nested: { rejected: true } }, async () => 'done')

    expect(observed).toMatchObject({
      name: 'standard.span',
      attributes: { safe: true },
      ended: true,
      status: 1,
    })
  })

  test('keeps product work fail-open when each OpenTelemetry boundary throws', async () => {
    const productError = new Error('product failure')

    function throwingSpan(method?: 'spanContext' | 'setStatus' | 'recordException' | 'end') {
      return {
        spanContext() {
          if (method === 'spanContext') throw new Error('span context failed')
          return { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }
        },
        setStatus() {
          if (method === 'setStatus') throw new Error('status failed')
          return this
        },
        recordException() {
          if (method === 'recordException') throw new Error('exception recording failed')
        },
        end() {
          if (method === 'end') throw new Error('end failed')
        },
      }
    }

    const successCases = [
      {
        name: 'context setup',
        options: {
          now: () => {
            throw new Error('clock failed')
          },
        },
      },
      {
        name: 'tracer acquisition',
        options: {
          openTelemetry: {
            getTracer: () => {
              throw new Error('acquisition failed')
            },
          },
        },
      },
      {
        name: 'startSpan',
        options: {
          tracer: {
            startSpan: () => {
              throw new Error('start failed')
            },
          },
        },
      },
      { name: 'spanContext', options: { tracer: { startSpan: () => throwingSpan('spanContext') } } },
      { name: 'setStatus', options: { tracer: { startSpan: () => throwingSpan('setStatus') } } },
      { name: 'end', options: { tracer: { startSpan: () => throwingSpan('end') } } },
      {
        name: 'active context',
        options: {
          tracer: { startSpan: () => throwingSpan() },
          openTelemetry: {
            active: () => {
              throw new Error('active failed')
            },
          },
        },
      },
      {
        name: 'setSpan',
        options: {
          tracer: { startSpan: () => throwingSpan() },
          openTelemetry: {
            active: () => ({}) as never,
            setSpan: () => {
              throw new Error('set span failed')
            },
          },
        },
      },
      {
        name: 'context.with before callback',
        options: {
          tracer: { startSpan: () => throwingSpan() },
          openTelemetry: {
            active: () => ({}) as never,
            setSpan: (context: never) => context,
            with: () => {
              throw new Error('context failed')
            },
          },
        },
      },
      {
        name: 'context.with after callback',
        options: {
          tracer: { startSpan: () => throwingSpan() },
          openTelemetry: {
            active: () => ({}) as never,
            setSpan: (context: never) => context,
            with: (_context: never, activeWork: () => Promise<unknown>) => {
              void activeWork()
              throw new Error('context failed after callback')
            },
          },
        },
      },
    ]

    for (const testCase of successCases) {
      let calls = 0
      const telemetry = createTelemetry({ service: 'test', drainIntervalMs: 0, ...testCase.options } as never)
      await expect(
        telemetry.trace(testCase.name, {}, async () => {
          calls++
          return 'product result'
        }),
      ).resolves.toBe('product result')
      expect(calls).toBe(1)
    }

    for (const method of ['recordException', 'setStatus', 'end'] as const) {
      let calls = 0
      const telemetry = createTelemetry({
        service: 'test',
        drainIntervalMs: 0,
        tracer: { startSpan: () => throwingSpan(method) } as never,
      })
      await expect(
        telemetry.trace(method, {}, async () => {
          calls++
          throw productError
        }),
      ).rejects.toBe(productError)
      expect(calls).toBe(1)
    }
  })

  test('uses valid provider span identifiers as canonical correlation identifiers', async () => {
    const telemetry = createTelemetry({
      service: 'test',
      drainIntervalMs: 0,
      sampleRate: 0,
      id: () => 'c'.repeat(32),
      tracer: {
        startSpan: () => ({
          spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }),
          setStatus() {
            return this
          },
          recordException() {},
          end() {},
        }),
      } as never,
    })

    const observed = await telemetry.trace('canonical', {}, async () => telemetry.current())

    expect(observed).toMatchObject({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), sampled: true })
  })

  test('uses a fixed metric catalog and bounded series', () => {
    const telemetry = createTelemetry({ service: 'test', maxSeriesPerMetric: 2, drainIntervalMs: 0 })
    telemetry.metrics.add('http_server_requests_total', 1, {
      runtime: 'api',
      method: 'GET',
      route: 'trpc',
      status_class: '2xx',
    })
    telemetry.metrics.add('http_server_requests_total', 1, {
      runtime: 'api',
      method: 'GET',
      route: 'unknown-id-123',
      status_class: '2xx',
    })
    telemetry.metrics.add('unknown_metric' as never, 1, {})
    telemetry.metrics.observe('http_server_duration_ms', 125, {
      runtime: 'api',
      method: 'GET',
      route: 'trpc',
      status_class: '2xx',
    })
    const operationTelemetry = createTelemetry({ service: 'test', drainIntervalMs: 0 })
    for (const kind of [
      'ranked-player-pulse',
      'player-discovery-projection',
      'clan-discovery-projection',
      'discovery-reconciliation',
    ]) {
      operationTelemetry.metrics.add('operation_attempts_total', 1, {
        kind,
        work_class: kind === 'ranked-player-pulse' ? 'primary-monitoring' : 'projection',
        outcome: 'succeeded',
      })
    }

    const output = renderPrometheus([...telemetry.metrics.snapshot(), ...operationTelemetry.metrics.snapshot()])
    expect(output).toContain('http_server_requests_total{method="GET",route="trpc",runtime="api",status_class="2xx"} 1')
    expect(output).toContain('http_server_duration_ms_bucket')
    expect(output).not.toContain('unknown-id-123')
    expect(output).toContain('kind="ranked-player-pulse"')
    expect(output).toContain('kind="clan-discovery-projection"')
    expect(output).toContain('kind="discovery-reconciliation"')
    expect(telemetry.stats().seriesDropped).toBe(2)
  })
})
