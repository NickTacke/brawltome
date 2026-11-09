import { describe, expect, test } from 'bun:test'
import { visitorRefreshInputSchema, visitorRefreshResponseSchema } from '../src'

const accepted = {
  outcome: 'accepted',
  operationId: '2ef5a585-e8b9-46df-8f95-53d03af42d11',
  retry: { kind: 'poll', afterSeconds: 2 },
} as const

describe('visitor refresh', () => {
  test('takes an id with an optional challenge answer and trust token', () => {
    const input = { id: 7, turnstileToken: 'answer', refreshTrust: 'v1.token' }

    expect(visitorRefreshInputSchema.parse({ id: 7 })).toEqual({ id: 7 })
    expect(visitorRefreshInputSchema.parse(input)).toEqual(input)
  })

  test('refuses ids outside the shared id range and unknown fields', () => {
    expect(visitorRefreshInputSchema.safeParse({ id: 0 }).success).toBe(false)
    expect(visitorRefreshInputSchema.safeParse({ id: 2_147_483_648 }).success).toBe(false)
    expect(visitorRefreshInputSchema.safeParse({ id: 7, ip: '203.0.113.9' }).success).toBe(false)
  })

  test('answers the outcome and a trust token only when one was granted', () => {
    const granted = { refresh: accepted, refreshTrust: 'v1.token' }
    const notGranted = { refresh: accepted, refreshTrust: null }

    expect(visitorRefreshResponseSchema.parse(granted)).toEqual(granted)
    expect(visitorRefreshResponseSchema.parse(notGranted)).toEqual(notGranted)
  })
})
