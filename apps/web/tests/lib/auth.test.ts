import { afterEach, describe, expect, mock, test } from 'bun:test'
import { parseAccountResponse, signOut } from '../../src/lib/auth'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('parseAccountResponse', () => {
  test('parses canonical anonymous and signed-in views', () => {
    expect(parseAccountResponse({ status: 'anonymous' })).toEqual({ status: 'anonymous' })
    expect(
      parseAccountResponse({
        status: 'signedIn',
        account: {
          id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
          displayName: 'Ada',
          avatarUrl: null,
          createdAt: '2026-08-09T18:42:01.000Z',
        },
      }),
    ).toMatchObject({ status: 'signedIn', account: { displayName: 'Ada' } })
  })

  test('rejects inferred API and persistence shapes', () => {
    expect(() =>
      parseAccountResponse({
        id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
        username: 'Ada',
        session: { id: 'secret' },
      }),
    ).toThrow()
  })
})

describe('signOut', () => {
  test('invalidates account state after successful revocation', async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const invalidations: unknown[] = []
    const queryClient = {
      async invalidateQueries(options: unknown) {
        invalidations.push(options)
      },
    } as Parameters<typeof signOut>[0]

    await signOut(queryClient)

    expect(invalidations).toEqual([{ queryKey: ['account', 'current'] }, { queryKey: ['identity', 'playerLink'] }])
  })

  test('rejects failed revocation without invalidating signed-in state', async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 500 })) as unknown as typeof fetch
    const invalidateQueries = mock(async () => {})
    const queryClient = { invalidateQueries } as unknown as Parameters<typeof signOut>[0]

    await expect(signOut(queryClient)).rejects.toThrow('Sign-out failed with status 500')
    expect(invalidateQueries).not.toHaveBeenCalled()
  })
})
