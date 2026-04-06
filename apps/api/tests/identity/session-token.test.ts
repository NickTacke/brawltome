import { describe, expect, it } from 'bun:test'
import { generateSessionToken, hashSessionToken } from '@brawltome/identity'

describe('generateSessionToken', () => {
  it('returns a url-safe base64 string of at least 40 chars', () => {
    const token = generateSessionToken()
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('does not collide across 1000 iterations', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 1000; i++) tokens.add(generateSessionToken())
    expect(tokens.size).toBe(1000)
  })
})

describe('hashSessionToken', () => {
  it('returns a 64-char lowercase hex sha-256 digest', () => {
    const hash = hashSessionToken('hello-world')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic', () => {
    expect(hashSessionToken('abc')).toBe(hashSessionToken('abc'))
  })

  it('produces distinct digests for distinct inputs', () => {
    expect(hashSessionToken('abc')).not.toBe(hashSessionToken('abd'))
  })
})
