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
})
