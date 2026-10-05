import { describe, expect, test } from 'bun:test'
import { TRPCClientError } from '@trpc/client'
import { trpcFailureEvent } from '../../../src/lib/analytics/trpc-link'

describe('trpcFailureEvent', () => {
  test('maps known codes and network failures', () => {
    const error = new TRPCClientError('nope', { result: { error: { data: { code: 'NOT_FOUND' } } } as never })
    expect(trpcFailureEvent('player.get', error)).toEqual({
      name: 'trpc.failed',
      procedure: 'player.get',
      code: 'NOT_FOUND',
    })
    expect(trpcFailureEvent('player.get', new TypeError('Failed to fetch'))).toMatchObject({ code: 'NETWORK' })
  })

  test('maps unknown codes to OTHER', () => {
    const error = new TRPCClientError('x', { result: { error: { data: { code: 'WEIRD' } } } as never })
    expect(trpcFailureEvent('a.b', error)).toMatchObject({ code: 'OTHER' })
  })
})
