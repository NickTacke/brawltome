import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AccountPreferencesContract, AccountPreferencesUpdateContract } from '@brawltome/contracts'

let preferenceMutation: (update: AccountPreferencesUpdateContract) => Promise<unknown> = async () => {
  throw new Error('preference mutation not configured')
}
mock.module('../../src/lib/trpc', () => ({
  trpc: {
    account: {
      updatePreferences: { mutate: (update: AccountPreferencesUpdateContract) => preferenceMutation(update) },
    },
  },
}))

const {
  parseAccountPreferencesResponse,
  parseAccountResponse,
  parsePrimaryPlayerResponse,
  saveAccountPreferences,
  signOut,
} = await import('../../src/lib/auth')

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('saveAccountPreferences', () => {
  test('serializes concurrent preference writes for one account', async () => {
    const updates: AccountPreferencesUpdateContract[] = []
    let firstStarted!: () => void
    let releaseFirst!: () => void
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const firstReleasePromise = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let preferences: AccountPreferencesContract = {
      version: 2 as const,
      leaderboardBracket: '1v1' as const,
      leaderboardRegion: 'all' as const,
      theme: 'neutral' as const,
    }
    preferenceMutation = async (update) => {
      updates.push(update)
      if (updates.length === 1) {
        firstStarted()
        await firstReleasePromise
      }
      preferences = { ...preferences, ...update }
      return preferences
    }

    const cachedPreferences: unknown[] = []
    const queryClient = {
      setQueryData: mock((_key: unknown, value: unknown) => cachedPreferences.push(value)),
    } as unknown as Parameters<typeof saveAccountPreferences>[0]
    const first = saveAccountPreferences(queryClient, 'account-id', { theme: 'purple' })
    await firstStartedPromise
    const second = saveAccountPreferences(queryClient, 'account-id', { leaderboardRegion: 'EU' })

    expect(updates).toEqual([{ theme: 'purple' }])
    releaseFirst()
    await Promise.all([first, second])
    expect(updates).toEqual([{ theme: 'purple' }, { leaderboardRegion: 'EU' }])
    expect(cachedPreferences.at(-1)).toEqual({
      version: 2,
      leaderboardBracket: '1v1',
      leaderboardRegion: 'EU',
      theme: 'purple',
    })
  })
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

describe('parseAccountPreferencesResponse', () => {
  test('accepts canonical account preferences and rejects unsupported themes', () => {
    const preferences = {
      version: 2,
      leaderboardBracket: 'solo2v2',
      leaderboardRegion: 'SEA',
      theme: 'purple',
    } as const
    expect(parseAccountPreferencesResponse(preferences)).toEqual(preferences)
    expect(() => parseAccountPreferencesResponse({ ...preferences, theme: 'dark' })).toThrow()
  })
})

describe('parsePrimaryPlayerResponse', () => {
  test('parses privacy-safe ownership history and rejects proof subjects', () => {
    const state = {
      primaryPlayer: null,
      attempts: [
        {
          id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
          status: 'pending' as const,
          startedAt: '2026-08-10T10:00:00.000Z',
          completedAt: null,
          player: null,
        },
      ],
    }
    expect(parsePrimaryPlayerResponse(state)).toEqual(state)
    expect(() =>
      parsePrimaryPlayerResponse({
        ...state,
        attempts: [{ ...state.attempts[0], steamId: 'private-proof-subject' }],
      }),
    ).toThrow()
  })
})

describe('signOut', () => {
  test('invalidates account state after successful revocation', async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const invalidations: unknown[] = []
    const removals: unknown[] = []
    const queryClient = {
      async invalidateQueries(options: unknown) {
        invalidations.push(options)
      },
      removeQueries(options: unknown) {
        removals.push(options)
      },
    } as Parameters<typeof signOut>[0]

    await signOut(queryClient)

    expect(invalidations).toEqual([{ queryKey: ['account', 'current'] }, { queryKey: ['account', 'primaryPlayer'] }])
    expect(removals).toEqual([
      { queryKey: ['account', 'preferences'] },
      { queryKey: ['account', 'pinnedPlayers'] },
      { queryKey: ['account', 'playerShortcuts'] },
    ])
  })

  test('rejects failed revocation without invalidating signed-in state', async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 500 })) as unknown as typeof fetch
    const invalidateQueries = mock(async () => {})
    const queryClient = {
      invalidateQueries,
      removeQueries: mock(() => {}),
    } as unknown as Parameters<typeof signOut>[0]

    await expect(signOut(queryClient)).rejects.toThrow('Sign-out failed with status 500')
    expect(invalidateQueries).not.toHaveBeenCalled()
  })
})
