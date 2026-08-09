import { describe, expect, test } from 'bun:test'
import type { ContractProof } from '@brawltome/contracts'
import { createContractProofRouter } from '../src/router/contract-proof.router'
import { createContractProofRoutes } from '../src/routes/contract-proof.routes'

const secret = 'contract-proof-secret'
const invalidMissingNullable = {
  count: 0,
  occurredAt: '2026-01-01T00:00:00Z',
  event: { kind: 'ready', attempt: 0 },
}
const invalidNegative = {
  ...invalidMissingNullable,
  count: -1,
  requiredNullable: null,
}
const invalidOutOfRange = {
  ...invalidMissingNullable,
  count: 2_147_483_648,
  requiredNullable: null,
}

describe('canonical tRPC producer', () => {
  test('returns validated plain JSON output', async () => {
    const caller = createContractProofRouter(undefined, secret).createCaller({ internalSecret: secret })
    expect(await caller.get()).toEqual({
      count: 0,
      requiredNullable: null,
      occurredAt: '2026-01-01T00:00:00Z',
      event: { kind: 'ready', attempt: 0 },
    })
  })

  test.each([invalidMissingNullable, invalidNegative, invalidOutOfRange])(
    'rejects invalid producer output',
    async (output) => {
      const caller = createContractProofRouter(() => output as ContractProof, secret).createCaller({
        internalSecret: secret,
      })
      await expect(caller.get()).rejects.toThrow('Output validation failed')
    },
  )
})

describe('canonical internal HTTP producer', () => {
  test('serializes validated output and requires the internal secret', async () => {
    const routes = createContractProofRoutes(undefined, secret)
    expect((await routes.request('/proof')).status).toBe(401)

    const response = await routes.request('/proof', { headers: { 'x-internal-secret': secret } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ count: 0, requiredNullable: null })
  })

  test.each([invalidMissingNullable, invalidNegative, invalidOutOfRange])(
    'rejects invalid producer output',
    async (output) => {
      const routes = createContractProofRoutes(() => output, secret)
      const response = await routes.request('/proof', { headers: { 'x-internal-secret': secret } })
      expect(response.status).toBe(500)
    },
  )
})
