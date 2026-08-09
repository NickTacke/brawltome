import { describe, expect, test } from 'bun:test'
import { accountViewSchema, parseAccountViewOutput } from '../src/account'

const signedInView = {
  status: 'signedIn' as const,
  account: {
    id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
    displayName: 'Ada',
    avatarUrl: null,
    createdAt: '2026-08-09T18:42:01.000Z',
  },
}

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
