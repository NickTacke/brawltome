import { describe, expect, test } from 'bun:test'
import { type Account, type AccountPreferences, type Accounts, DEFAULT_ACCOUNT_PREFERENCES } from '@brawltome/accounts'
import { accountPreferencesSchema, accountViewSchema, primaryPlayerVerificationStateSchema } from '@brawltome/contracts'
import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { toAccountPreferences, toAccountView, toPrimaryPlayerVerificationState } from '../src/mappers/account.mapper'
import { accountRouter } from '../src/router/account.router'

interface TestContext {
  account: Account | null
  accounts: Accounts
}

const t = initTRPC.context<TestContext>().create({ transformer: superjson })
const caller = t.createCallerFactory(accountRouter as unknown as ReturnType<typeof t.router>)

const accounts = {
  async signInWithDiscord() {
    throw new Error('not used')
  },
  async authenticate() {
    return { status: 'anonymous' }
  },
  async signOut() {},
  async getPreferences() {
    return DEFAULT_ACCOUNT_PREFERENCES
  },
  async updatePreferences(_accountId, preferences) {
    return preferences
  },
  async beginPrimaryPlayerVerification() {
    throw new Error('not used')
  },
  async resolvePrimaryPlayerVerification() {
    throw new Error('not used')
  },
  async getPrimaryPlayerVerificationState() {
    return {
      primaryPlayer: { brawlhallaId: 42, name: 'Ada', verifiedAt: new Date('2026-08-10T10:02:00.000Z') },
      attempts: [
        {
          id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
          status: 'verified' as const,
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          completedAt: new Date('2026-08-10T10:02:00.000Z'),
          player: { brawlhallaId: 42, name: 'Ada' },
        },
      ],
    }
  },
} satisfies Accounts

const account: Account = {
  id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
  displayName: 'Ada',
  avatarUrl: null,
  createdAt: new Date('2026-08-09T18:42:01.000Z'),
}

function makeAccounts() {
  let preferences: AccountPreferences = { ...DEFAULT_ACCOUNT_PREFERENCES }
  const service: Accounts = {
    async signInWithDiscord() {
      throw new Error('Not used')
    },
    async authenticate() {
      return { status: 'anonymous' }
    },
    async signOut() {},
    async getPreferences() {
      return preferences
    },
    async updatePreferences(_accountId, nextPreferences) {
      preferences = nextPreferences
      return preferences
    },
    async beginPrimaryPlayerVerification() {
      throw new Error('Not used')
    },
    async resolvePrimaryPlayerVerification() {
      throw new Error('Not used')
    },
    async getPrimaryPlayerVerificationState() {
      return { primaryPlayer: null, attempts: [] }
    },
  }
  return service
}

function context(currentAccount: Account | null): TestContext {
  return { account: currentAccount, accounts: makeAccounts() }
}

describe('account.current', () => {
  test('returns the canonical anonymous view', async () => {
    const result = await (caller(context(null)) as { current: () => Promise<unknown> }).current()
    expect(result).toEqual({ status: 'anonymous' })
    expect(accountViewSchema.parse(result)).toEqual({ status: 'anonymous' })
  })

  test('rejects malformed producer output', () => {
    expect(() => toAccountView({ ...account, id: 'not-a-uuid' })).toThrow()
  })

  test('returns the canonical signed-in view with an ISO UTC timestamp', async () => {
    const result = await (caller(context(account)) as { current: () => Promise<unknown> }).current()
    expect(result).toEqual({
      status: 'signedIn',
      account: {
        id: account.id,
        displayName: 'Ada',
        avatarUrl: null,
        createdAt: '2026-08-09T18:42:01.000Z',
      },
    })
  })

  test('returns canonical Primary Player ownership and privacy-safe attempt history', async () => {
    const result = await (caller({ account, accounts }) as { primaryPlayer: () => Promise<unknown> }).primaryPlayer()

    expect(primaryPlayerVerificationStateSchema.parse(result)).toEqual({
      primaryPlayer: { brawlhallaId: 42, name: 'Ada', verifiedAt: '2026-08-10T10:02:00.000Z' },
      attempts: [
        {
          id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
          status: 'verified',
          startedAt: '2026-08-10T10:00:00.000Z',
          completedAt: '2026-08-10T10:02:00.000Z',
          player: { brawlhallaId: 42, name: 'Ada' },
        },
      ],
    })
  })

  test('rejects malformed Primary Player producer state', () => {
    expect(() =>
      toPrimaryPlayerVerificationState({
        primaryPlayer: null,
        attempts: [
          {
            id: 'not-a-uuid',
            status: 'pending',
            startedAt: new Date(),
            completedAt: null,
            player: null,
          },
        ],
      }),
    ).toThrow()
  })
})

describe('account.preferences', () => {
  test('returns canonical defaults without requiring or exposing an account', async () => {
    const result = await (caller(context(null)) as { preferences: () => Promise<unknown> }).preferences()

    expect(result).toEqual(DEFAULT_ACCOUNT_PREFERENCES)
    expect(accountPreferencesSchema.parse(result)).toEqual(DEFAULT_ACCOUNT_PREFERENCES)
  })

  test('round-trips a validated update for the authenticated account', async () => {
    const api = caller(context(account)) as {
      preferences: () => Promise<unknown>
      updatePreferences: (input: AccountPreferences) => Promise<unknown>
    }
    const updated = { version: 1 as const, leaderboardBracket: '2v2' as const, leaderboardRegion: 'US-W' as const }

    expect(await api.updatePreferences(updated)).toEqual(updated)
    expect(await api.preferences()).toEqual(updated)
  })

  test('rejects anonymous updates and unknown fields', async () => {
    const anonymousApi = caller(context(null)) as {
      updatePreferences: (input: unknown) => Promise<unknown>
    }
    const signedInApi = caller(context(account)) as {
      updatePreferences: (input: unknown) => Promise<unknown>
    }

    await expect(anonymousApi.updatePreferences(DEFAULT_ACCOUNT_PREFERENCES)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(
      signedInApi.updatePreferences({ ...DEFAULT_ACCOUNT_PREFERENCES, theme: 'dark' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  test('rejects unsupported producer output', () => {
    expect(() =>
      toAccountPreferences({
        version: 2,
        leaderboardBracket: '1v1',
        leaderboardRegion: 'all',
      } as never),
    ).toThrow()
  })
})
