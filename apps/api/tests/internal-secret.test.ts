import { describe, expect, it } from 'bun:test'
import { internalSecretValid } from '../src/auth/internal-secret'

describe('internalSecretValid', () => {
  it('returns true for matching secrets', () => {
    expect(internalSecretValid('my-secret-value', 'my-secret-value')).toBe(true)
  })

  it('returns false for same-length wrong secret', () => {
    expect(internalSecretValid('wrong-secret-val', 'my-secret-value!')).toBe(false)
  })

  it('returns false when provided is undefined', () => {
    expect(internalSecretValid(undefined, 'my-secret-value')).toBe(false)
  })

  it('returns false when expected is undefined', () => {
    expect(internalSecretValid('my-secret-value', undefined)).toBe(false)
  })

  it('returns false for different lengths without throwing', () => {
    expect(() => internalSecretValid('short', 'a-much-longer-secret')).not.toThrow()
    expect(internalSecretValid('short', 'a-much-longer-secret')).toBe(false)
  })
})
