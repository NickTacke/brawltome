import { describe, expect, test } from 'bun:test'

const validBody = {
  events: [{ tabId: 'c'.repeat(32), route: '/', device: 'desktop', viewport: '>1440', t: 1, name: 'pageview' }],
}

describe('POST /api/a', () => {
  test('answers 204 for malformed bodies', async () => {
    const { POST } = await import('../../../src/app/api/a/route')
    const response = await POST(new Request('http://localhost/api/a', { method: 'POST', body: 'not json' }))
    expect(response.status).toBe(204)
  })

  test('answers 204 for a valid body', async () => {
    const { POST } = await import('../../../src/app/api/a/route')
    const response = await POST(
      new Request('http://localhost/api/a', {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'x' },
      }),
    )
    expect(response.status).toBe(204)
  })

  test('drops a body whose content-length exceeds the cap without reading it', async () => {
    const { POST } = await import('../../../src/app/api/a/route')
    const { webTelemetry } = await import('../../../src/lib/web-telemetry-registry')
    const before = droppedInvalid(webTelemetry)
    const request = new Request('http://localhost/api/a', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'content-length': '64001' },
    })
    let read = false
    request.text = async () => {
      read = true
      return ''
    }
    const response = await POST(request)
    expect(response.status).toBe(204)
    expect(read).toBe(false)
    expect(droppedInvalid(webTelemetry)).toBe(before + 1)
  })

  test('stops reading a chunked body once it exceeds the cap', async () => {
    const { POST } = await import('../../../src/app/api/a/route')
    const { webTelemetry } = await import('../../../src/lib/web-telemetry-registry')
    const before = droppedInvalid(webTelemetry)
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(16_000).fill(97))
        if (pulled > 1000) controller.close()
      },
    })
    const request = new Request('http://localhost/api/a', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    const response = await POST(request)
    expect(response.status).toBe(204)
    expect(pulled).toBeLessThan(20)
    expect(droppedInvalid(webTelemetry)).toBe(before + 1)
  })
})

function droppedInvalid(telemetry: { metrics: { snapshot(): Array<{ name: string; series?: unknown }> } }): number {
  const metric = telemetry.metrics.snapshot().find((m) => m.name === 'analytics_events_dropped_total')
  const series = (metric?.series ?? []) as Array<{ labels: Record<string, string>; value: number }>
  return series.filter((s) => s.labels.reason === 'invalid').reduce((sum, s) => sum + s.value, 0)
}
