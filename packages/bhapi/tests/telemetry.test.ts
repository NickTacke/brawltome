import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { BhApiClient } from '../src/client'

let server: ReturnType<typeof Bun.serve>
let baseUrl = ''

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path.includes('/player/42/ranked')) return Response.json({ brawlhalla_id: 42 })
      return new Response('private upstream body token=secret', { status: 500 })
    },
  })
  baseUrl = `http://127.0.0.1:${server.port}`
})

afterAll(async () => server.stop(true))

describe('Brawlhalla source telemetry', () => {
  test('records bounded source outcomes without leaking credentials, URLs, or bodies', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'test', sink, drainIntervalMs: 0 })
    const client = new BhApiClient({ apiKey: 'irreplaceable-secret', baseUrl, telemetry })

    await client.getPlayerRanked(42)
    await expect(client.getPlayerRanked(99)).rejects.toThrow('Brawlhalla API error')
    await telemetry.flush(50)

    const output = `${JSON.stringify(telemetry.metrics.snapshot())}${JSON.stringify(sink.records)}`
    expect(output).toContain('brawlhalla-v0')
    expect(output).not.toContain('irreplaceable-secret')
    expect(output).not.toContain('/player/42')
    expect(output).not.toContain('private upstream body')
  })
})
