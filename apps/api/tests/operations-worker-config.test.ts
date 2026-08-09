import { describe, expect, test } from 'bun:test'
import { readOperationsWorkerConfig } from '../src/operations-worker-config'

describe('operations worker configuration', () => {
  test('uses conservative defaults and rejects unsafe timing values', () => {
    expect(readOperationsWorkerConfig({})).toEqual({ leaseMs: 30_000, pollMs: 1_000, retryDelayMs: 1_000 })
    for (const value of ['0', '-1', 'NaN', '1.5', '999999999']) {
      expect(() => readOperationsWorkerConfig({ OPERATIONS_LEASE_MS: value })).toThrow('OPERATIONS_LEASE_MS')
    }
  })
})
