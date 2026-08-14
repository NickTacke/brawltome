import { describe, expect, test } from 'bun:test'
import { type RuntimeConfig, createReplaySimulatorRuntimeApp } from '../src/replay-simulator-runtime'

const config: RuntimeConfig = {
  runner: '/usr/bin/true',
  homeDir: '/tmp',
  steamRoot: '/tmp/steam',
  gameDir: '/tmp/game',
  protonDir: '/tmp/proton',
  playbackMode: 'seek-end',
  timeoutMs: 1_000,
  termGraceMs: 10,
}

describe('replay simulator runtime HTTP service', () => {
  test('refuses simulation before readiness succeeds', async () => {
    const app = createReplaySimulatorRuntimeApp({
      config,
      lifecycleSignal: new AbortController().signal,
      readinessCheck: async () => {
        throw new Error('not ready')
      },
    })

    const response = await app.request('/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'ABC123xyz', replayBase64: 'AQID', expectedDumps: 1 }),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'replay_runtime_unready', retryable: true } })
  })

  test('rejects malformed requests permanently', async () => {
    const app = createReplaySimulatorRuntimeApp({ config, lifecycleSignal: new AbortController().signal })

    const response = await app.request('/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'replay_request_malformed', retryable: false } })
  })

  test('rejects oversized replay payloads before launching Steam', async () => {
    const app = createReplaySimulatorRuntimeApp({ config, lifecycleSignal: new AbortController().signal })
    const replayBase64 = Buffer.alloc(200 * 1024 + 1).toString('base64')

    const response = await app.request('/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'ABC123xyz', replayBase64, expectedDumps: 1 }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: 'replay_request_oversize', retryable: false } })
  })

  test('classifies missing terminal dumps as permanent without launching Steam', async () => {
    const app = createReplaySimulatorRuntimeApp({ config, lifecycleSignal: new AbortController().signal })

    const response = await app.request('/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'ABC123xyz', replayBase64: 'AQID', expectedDumps: 1 }),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'replay_dump_cardinality', retryable: false } })
  })
})
