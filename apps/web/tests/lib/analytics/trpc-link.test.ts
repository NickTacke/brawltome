import { describe, expect, test } from 'bun:test'
import { TRPCClientError } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import { analyticsLink, trpcFailureEvent } from '../../../src/lib/analytics/trpc-link'

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

describe('analyticsLink', () => {
  const run = (
    source: (observer: { next: (v: unknown) => void; error: (e: unknown) => void; complete: () => void }) => void,
  ) => {
    const link = analyticsLink({} as never)
    const seen: unknown[] = []
    const op = { path: 'player.get' } as never
    link({ op, next: () => observable(source as never) } as never).subscribe({
      next: (value) => seen.push(['next', value]),
      error: (err) => seen.push(['error', err]),
      complete: () => seen.push(['complete']),
    })
    return seen
  }

  test('forwards values and completion', () => {
    const value = { result: { data: 1 } }
    const seen = run((observer) => {
      observer.next(value)
      observer.complete()
    })
    expect(seen).toEqual([['next', value], ['complete']])
  })

  test('forwards the same error instance even when tracking throws', () => {
    const error = new TRPCClientError('network')
    Object.defineProperty(error, 'data', {
      get() {
        throw new Error('hostile')
      },
    })
    const seen = run((observer) => observer.error(error))
    expect(seen).toHaveLength(1)
    expect((seen[0] as unknown[])[1]).toBe(error)
  })
})
