import { describe, expect, test } from 'bun:test'
import { checkWebReadiness } from '../../src/lib/web-readiness'

describe('web readiness', () => {
  test('is ready only when the internal API is ready', async () => {
    const result = await checkWebReadiness('http://api:3000', async (input) => {
      expect(input).toBe('http://api:3000/health/ready')
      return new Response('{"status":"ready"}', { status: 200 })
    })

    expect(result).toEqual({ status: 'ready' })
  })

  test('reports dependency startup without exposing response bodies', async () => {
    const result = await checkWebReadiness(
      'http://api:3000',
      async () => new Response('database host and secret details', { status: 503 }),
    )

    expect(result).toEqual({ status: 'starting', dependency: 'api', dependencyStatus: 503 })
  })

  test('bounds failed dependency probes', async () => {
    const result = await checkWebReadiness('http://api:3000', async () => {
      throw new Error('connection details')
    })

    expect(result).toEqual({ status: 'starting', dependency: 'api' })
  })
})
