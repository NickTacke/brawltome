import { describe, expect, test } from 'bun:test'
import type { AcceptProofOperation } from '@brawltome/refresh-operations'
import { createRefreshOperationRoutes } from '../src/routes/refresh-operations.routes'

const secret = 'operations-route-secret-operations-route-secret'

describe('Refresh Operations internal producer', () => {
  test('authenticates, validates, and returns durable acceptance semantics', async () => {
    const accepted: AcceptProofOperation[] = []
    const app = createRefreshOperationRoutes(
      {
        async accept(input) {
          accepted.push(input)
          return { outcome: 'accepted', operationId: 'operation-1' }
        },
      },
      secret,
    )

    const unauthorized = await app.request('/proof', { method: 'POST', body: '{}' })
    expect(unauthorized.status).toBe(401)
    const oversized = await app.request('/proof', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ value: 'x'.repeat(5_000) }),
    })
    expect(oversized.status).toBe(413)

    const response = await app.request('/proof', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        dedupeKey: 'proof:one',
        operationKey: 'effect:one',
        value: 'once',
        requestedBy: 'integration',
      }),
    })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ outcome: 'accepted', operationId: 'operation-1' })
    expect(accepted).toEqual([
      {
        dedupeKey: 'proof:one',
        operationKey: 'effect:one',
        workClass: 'interactive',
        payload: { value: 'once' },
        provenance: { source: 'internal-api', requestedBy: 'integration' },
        maxAttempts: undefined,
      },
    ])
  })
})
