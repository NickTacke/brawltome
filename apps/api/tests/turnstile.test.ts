import { describe, expect, mock, test } from 'bun:test'
import { verifyTurnstile } from '../src/services/turnstile.service'

describe('verifyTurnstile', () => {
  test('returns true for valid token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })),
    ) as typeof fetch
    try {
      const result = await verifyTurnstile('valid-token', '1.2.3.4')
      expect(result).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.TURNSTILE_SECRET_KEY
    }
  })

  test('returns false for invalid token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 200 })),
    ) as typeof fetch
    try {
      const result = await verifyTurnstile('bad-token', '1.2.3.4')
      expect(result).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.TURNSTILE_SECRET_KEY
    }
  })

  test('returns false on network error', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() => Promise.reject(new Error('network error'))) as typeof fetch
    try {
      const result = await verifyTurnstile('token', '1.2.3.4')
      expect(result).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.TURNSTILE_SECRET_KEY
    }
  })

  test('returns true when no secret key configured (dev mode)', async () => {
    const originalEnv = process.env.TURNSTILE_SECRET_KEY
    delete process.env.TURNSTILE_SECRET_KEY
    try {
      const result = await verifyTurnstile('any-token', '1.2.3.4')
      expect(result).toBe(true)
    } finally {
      if (originalEnv !== undefined) process.env.TURNSTILE_SECRET_KEY = originalEnv
    }
  })
})
