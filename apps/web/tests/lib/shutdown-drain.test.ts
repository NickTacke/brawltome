import { afterEach, describe, expect, test } from 'bun:test'
import { GET } from '../../src/app/api/health/serving/route'

const drainingKey = Symbol.for('brawltome.web.draining')
const flags = globalThis as Record<symbol, unknown>

describe('web load balancer membership', () => {
  afterEach(() => {
    delete flags[drainingKey]
  })

  test('serves until the launcher announces shutdown', async () => {
    const serving = GET()
    expect(serving.status).toBe(200)
    expect(await serving.json()).toEqual({ status: 'serving' })

    flags[drainingKey] = true
    const draining = GET()
    expect(draining.status).toBe(503)
    expect(await draining.json()).toEqual({ status: 'draining' })
    expect(draining.headers.get('cache-control')).toBe('no-store')
  })
})
