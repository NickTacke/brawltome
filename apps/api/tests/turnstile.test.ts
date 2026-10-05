import { describe, expect, mock, test } from 'bun:test'
import { verifyTurnstile, verifyTurnstileResult } from '../src/auth/turnstile'

// Assigning undefined to process.env stores the string 'undefined', so unset by deleting the key.
function restoreEnv(env: Record<string, string | undefined>, name: string, value: string | undefined) {
  if (value === undefined) Reflect.deleteProperty(env, name)
  else env[name] = value
}

describe('verifyTurnstile', () => {
  test('returns true for valid token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })),
    ) as unknown as typeof fetch
    try {
      const result = await verifyTurnstile('valid-token', '1.2.3.4')
      expect(result).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
      Reflect.deleteProperty(process.env, 'TURNSTILE_SECRET_KEY')
    }
  })

  test('returns false for invalid token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 200 })),
    ) as unknown as typeof fetch
    try {
      const result = await verifyTurnstile('bad-token', '1.2.3.4')
      expect(result).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      Reflect.deleteProperty(process.env, 'TURNSTILE_SECRET_KEY')
    }
  })

  test('distinguishes verifier failure from invalid challenge', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    ) as unknown as typeof fetch
    try {
      expect(await verifyTurnstileResult('token', '1.2.3.4')).toBe('unavailable')
    } finally {
      globalThis.fetch = originalFetch
      Reflect.deleteProperty(process.env, 'TURNSTILE_SECRET_KEY')
    }
  })

  test('returns false on network error', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() => Promise.reject(new Error('network error'))) as unknown as typeof fetch
    try {
      const result = await verifyTurnstile('token', '1.2.3.4')
      expect(result).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      Reflect.deleteProperty(process.env, 'TURNSTILE_SECRET_KEY')
    }
  })

  test('returns true when no secret key configured (dev mode)', async () => {
    const env = process.env as Record<string, string | undefined>
    const originalEnv = env.TURNSTILE_SECRET_KEY
    const originalNodeEnv = env.NODE_ENV
    Reflect.deleteProperty(env, 'TURNSTILE_SECRET_KEY')
    Reflect.deleteProperty(env, 'NODE_ENV')
    try {
      const result = await verifyTurnstile('any-token', '1.2.3.4')
      expect(result).toBe(true)
    } finally {
      if (originalEnv !== undefined) env.TURNSTILE_SECRET_KEY = originalEnv
      restoreEnv(env, 'NODE_ENV', originalNodeEnv)
    }
  })

  test('returns false when no secret key in production', async () => {
    const env = process.env as Record<string, string | undefined>
    const originalEnv = env.TURNSTILE_SECRET_KEY
    const originalNodeEnv = env.NODE_ENV
    Reflect.deleteProperty(env, 'TURNSTILE_SECRET_KEY')
    env.NODE_ENV = 'production'
    try {
      const result = await verifyTurnstile('any-token', '1.2.3.4')
      expect(result).toBe(false)
    } finally {
      if (originalEnv !== undefined) env.TURNSTILE_SECRET_KEY = originalEnv
      restoreEnv(env, 'NODE_ENV', originalNodeEnv)
    }
  })
})
