import { describe, expect, test } from 'bun:test'
import { createTelemetry } from '@brawltome/telemetry'
import { createOrpcContext } from '../src/orpc/context'

const internalSecret = 'orpc-context-test-secret-of-32-characters'
const options = { telemetry: createTelemetry({ service: 'api', drainIntervalMs: 0 }), internalSecret }

function contextFor(headers: Record<string, string>) {
  return createOrpcContext(new Request('http://api.test/v1/account', { headers }), options)
}

describe('the visitor session an internal caller forwards', () => {
  test('reaches the procedures when the site sends it with the secret', () => {
    const context = contextFor({ 'x-internal-secret': internalSecret, 'x-visitor-session': 'raw-token' })

    expect(context.visitorSessionToken).toBe('raw-token')
  })

  test('is ignored without the secret', () => {
    const context = contextFor({ 'x-visitor-session': 'raw-token' })

    expect(context.visitorSessionToken).toBeUndefined()
  })

  test('is ignored with a wrong secret', () => {
    const context = contextFor({ 'x-internal-secret': `${internalSecret}-wrong`, 'x-visitor-session': 'raw-token' })

    expect(context.visitorSessionToken).toBeUndefined()
  })

  // a browser calling the api directly sends its cookie, which only tRPC and the auth routes read
  test('is never taken from a cookie', () => {
    const context = contextFor({ 'x-internal-secret': internalSecret, cookie: 'brawltome_session=raw-token' })

    expect(context.visitorSessionToken).toBeUndefined()
  })

  test('is left out when the site sends none', () => {
    const context = contextFor({ 'x-internal-secret': internalSecret })

    expect(context.visitorSessionToken).toBeUndefined()
  })
})
