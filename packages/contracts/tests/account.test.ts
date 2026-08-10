import { describe, expect, test } from 'bun:test'
import { accountPreferencesSchema, accountViewSchema, parseAccountViewOutput } from '../src/account'

const signedInView = {
  status: 'signedIn' as const,
  account: {
    id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
    displayName: 'Ada',
    avatarUrl: null,
    createdAt: '2026-08-09T18:42:01.000Z',
  },
}

describe('accountPreferencesSchema', () => {
  test('defines only the launch-consumed leaderboard preferences in version 1', () => {
    const preferences = {
      version: 1 as const,
      leaderboardBracket: 'solo2v2' as const,
      leaderboardRegion: 'EU' as const,
    }

    expect(accountPreferencesSchema.parse(preferences)).toEqual(preferences)
  })

  test('rejects unknown, retired, partial, and unsupported preferences', () => {
    expect(() =>
      accountPreferencesSchema.parse({
        version: 1,
        leaderboardBracket: '1v1',
        leaderboardRegion: 'all',
        theme: 'dark',
      }),
    ).toThrow()
    expect(() => accountPreferencesSchema.parse({ version: 1, leaderboardBracket: '1v1' })).toThrow()
    expect(() =>
      accountPreferencesSchema.parse({
        version: 2,
        leaderboardBracket: '1v1',
        leaderboardRegion: 'all',
      }),
    ).toThrow()
  })
})

describe('accountViewSchema', () => {
  test('represents anonymous and signed-in account views', () => {
    expect(parseAccountViewOutput({ status: 'anonymous' })).toEqual({ status: 'anonymous' })
    expect(parseAccountViewOutput(signedInView)).toEqual(signedInView)
  })

  test('accepts a canonical avatar URL', () => {
    const result = accountViewSchema.parse({
      ...signedInView,
      account: { ...signedInView.account, avatarUrl: 'https://cdn.discordapp.com/avatar.png' },
    })
    if (result.status !== 'signedIn') throw new Error('Expected signed-in account')
    expect(result.account).toMatchObject({ avatarUrl: 'https://cdn.discordapp.com/avatar.png' })
  })

  test('rejects non-UTC timestamps and persistence details', () => {
    expect(() =>
      accountViewSchema.parse({
        ...signedInView,
        account: { ...signedInView.account, createdAt: '2026-08-09T19:42:01+01:00' },
      }),
    ).toThrow()
    expect(() =>
      accountViewSchema.parse({
        ...signedInView,
        account: { ...signedInView.account, providerAccountId: 'discord-42' },
      }),
    ).toThrow()
    expect(() => accountViewSchema.parse({ status: 'anonymous', session: { id: 'secret' } })).toThrow()
  })
})
