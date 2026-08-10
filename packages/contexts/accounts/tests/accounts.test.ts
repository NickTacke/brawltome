import { describe, expect, test } from 'bun:test'
import {
  type AccountsStore,
  DEFAULT_ACCOUNT_PREFERENCES,
  InvalidAccountPreferencesError,
  createAccounts,
} from '../src/accounts'

const ACCOUNT_ID = '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295'
const now = new Date('2026-08-09T18:00:00.000Z')

function makeStore() {
  const accounts = new Map<string, { id: string; displayName: string; avatarUrl: string | null; createdAt: Date }>()
  const sessions = new Map<string, { accountId: string; expiresAt: Date }>()
  const preferences = new Map<string, typeof DEFAULT_ACCOUNT_PREFERENCES>()
  const store: AccountsStore = {
    async upsertDiscordIdentity(profile) {
      const existing = accounts.get(profile.providerAccountId)
      if (existing) {
        existing.displayName = profile.displayName
        existing.avatarUrl = profile.avatarHash
          ? `https://cdn.discordapp.com/avatars/${profile.providerAccountId}/${profile.avatarHash}.png`
          : null
        return existing
      }
      const account = {
        id: ACCOUNT_ID,
        displayName: profile.displayName,
        avatarUrl: profile.avatarHash
          ? `https://cdn.discordapp.com/avatars/${profile.providerAccountId}/${profile.avatarHash}.png`
          : null,
        createdAt: now,
      }
      accounts.set(profile.providerAccountId, account)
      return account
    },
    async createSession(session) {
      sessions.set(session.id, { accountId: session.accountId, expiresAt: session.expiresAt })
    },
    async findSessionAccount(id) {
      const session = sessions.get(id)
      if (!session) return null
      const account = [...accounts.values()].find(({ id: accountId }) => accountId === session.accountId)
      return account ? { account, expiresAt: session.expiresAt } : null
    },
    async extendSession(id, expiresAt) {
      const session = sessions.get(id)
      if (session) session.expiresAt = expiresAt
    },
    async deleteSession(id) {
      sessions.delete(id)
    },
    async findPreferences(accountId) {
      return preferences.get(accountId) ?? null
    },
    async upsertPreferences(accountId, nextPreferences) {
      preferences.set(accountId, nextPreferences)
      return nextPreferences
    },
    async beginPrimaryPlayerVerification() {
      throw new Error('not used')
    },
    async findPrimaryPlayerVerificationAttempt() {
      return null
    },
    async completePrimaryPlayerVerification() {
      throw new Error('not used')
    },
    async getPrimaryPlayerVerificationState() {
      return { primaryPlayer: null, attempts: [] }
    },
    async readPrimaryMonitoringSnapshot() {
      return { observedAt: now, targets: [] }
    },
  }
  return { store, accounts, sessions, preferences }
}

function makeAccounts(store: AccountsStore, token = 'raw-session-token') {
  return createAccounts({ store, now: () => now, generateToken: () => token })
}

describe('Accounts', () => {
  test('generates unique URL-safe 32-byte session tokens', async () => {
    const state = makeStore()
    const accounts = createAccounts({ store: state.store, now: () => now })
    const tokens = new Set<string>()

    for (let index = 0; index < 100; index += 1) {
      const result = await accounts.signInWithDiscord({
        providerAccountId: 'discord-42',
        displayName: 'Ada',
        avatarHash: null,
      })
      expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
      tokens.add(result.sessionToken)
    }

    expect(tokens.size).toBe(100)
  })

  test('signs in with Discord, stores only a token hash, and preserves the account identity on repeat sign-in', async () => {
    const state = makeStore()
    const accounts = makeAccounts(state.store)

    const first = await accounts.signInWithDiscord({
      providerAccountId: 'discord-42',
      displayName: 'Ada',
      avatarHash: 'avatar',
    })
    const second = await accounts.signInWithDiscord({
      providerAccountId: 'discord-42',
      displayName: 'Ada Updated',
      avatarHash: null,
    })

    expect(first.account.id).toBe(ACCOUNT_ID)
    expect(second.account.id).toBe(ACCOUNT_ID)
    expect(second.account.displayName).toBe('Ada Updated')
    expect(first.sessionToken).toBe('raw-session-token')
    expect([...state.sessions.keys()]).toEqual(['e6c276c51996dfa4b71f39f34f5f1a5a8f116e29eb538fab6403dd689631c622'])
    expect(first.expiresAt.toISOString()).toBe('2026-09-08T18:00:00.000Z')
  })

  test('returns anonymous semantics for absent, unknown, expired, and orphaned sessions', async () => {
    const state = makeStore()
    const accounts = makeAccounts(state.store)

    expect(await accounts.authenticate(null)).toEqual({ status: 'anonymous' })
    expect(await accounts.authenticate('unknown')).toEqual({ status: 'anonymous' })

    await state.store.createSession({
      id: 'fa64ea1e82e1206f828ab2a02917c7e92accb98e3b95881a1b4ad52b914b66e3',
      accountId: ACCOUNT_ID,
      expiresAt: now,
    })
    expect(await accounts.authenticate('expired')).toEqual({ status: 'anonymous' })

    await state.store.createSession({
      id: '88f6811ab5d8fc6d3177f9b7609ae0fcebfda187e5046b62d38bb539e88b74d7',
      accountId: ACCOUNT_ID,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    })
    expect(await accounts.authenticate('orphan')).toEqual({ status: 'anonymous' })
  })

  test('authenticates a valid session and rolls it to 30 days inside the seven-day threshold', async () => {
    const state = makeStore()
    const accounts = makeAccounts(state.store)
    await accounts.signInWithDiscord({
      providerAccountId: 'discord-42',
      displayName: 'Ada',
      avatarHash: null,
    })
    const session = [...state.sessions.values()][0]
    session.expiresAt = new Date('2026-08-12T18:00:00.000Z')

    const result = await accounts.authenticate('raw-session-token')

    expect(result.status).toBe('signedIn')
    if (result.status !== 'signedIn') throw new Error('Expected signed-in account')
    expect(result.account).toMatchObject({ id: ACCOUNT_ID, displayName: 'Ada', avatarUrl: null })
    expect(result.extended).toBe(true)
    expect(result.expiresAt.toISOString()).toBe('2026-09-08T18:00:00.000Z')
  })

  test('does not roll a session with at least seven days remaining', async () => {
    const state = makeStore()
    const accounts = makeAccounts(state.store)
    await accounts.signInWithDiscord({
      providerAccountId: 'discord-42',
      displayName: 'Ada',
      avatarHash: null,
    })

    const result = await accounts.authenticate('raw-session-token')
    expect(result).toMatchObject({ status: 'signedIn', extended: false })
  })

  test('returns anonymous defaults without storing tracking state', async () => {
    const state = makeStore()
    const accounts = makeAccounts(state.store)

    expect(await accounts.getPreferences(null)).toEqual(DEFAULT_ACCOUNT_PREFERENCES)
    expect(state.preferences.size).toBe(0)
  })

  test('round-trips one explicit preference version for an account', async () => {
    const state = makeStore()
    const accounts = makeAccounts(state.store)
    const updated = {
      version: 1 as const,
      leaderboardBracket: '3v3' as const,
      leaderboardRegion: 'JPN' as const,
    }

    expect(await accounts.getPreferences(ACCOUNT_ID)).toEqual(DEFAULT_ACCOUNT_PREFERENCES)
    expect(await accounts.updatePreferences(ACCOUNT_ID, updated)).toEqual(updated)
    expect(await accounts.getPreferences(ACCOUNT_ID)).toEqual(updated)
  })

  test('rejects unsupported values at the Accounts boundary without changing stored preferences', async () => {
    const state = makeStore()
    const accounts = makeAccounts(state.store)

    await expect(
      accounts.updatePreferences(ACCOUNT_ID, {
        version: 1,
        leaderboardBracket: 'ranked' as '1v1',
        leaderboardRegion: 'EU',
      }),
    ).rejects.toBeInstanceOf(InvalidAccountPreferencesError)
    await expect(
      accounts.updatePreferences(ACCOUNT_ID, {
        ...DEFAULT_ACCOUNT_PREFERENCES,
        theme: 'dark',
      } as never),
    ).rejects.toBeInstanceOf(InvalidAccountPreferencesError)
    expect(await accounts.getPreferences(ACCOUNT_ID)).toEqual(DEFAULT_ACCOUNT_PREFERENCES)
  })

  test('sign-out revokes known sessions and is idempotent for unknown tokens', async () => {
    const state = makeStore()
    const accounts = makeAccounts(state.store)
    await accounts.signInWithDiscord({
      providerAccountId: 'discord-42',
      displayName: 'Ada',
      avatarHash: null,
    })

    await accounts.signOut('raw-session-token')
    await accounts.signOut('unknown')

    expect(await accounts.authenticate('raw-session-token')).toEqual({ status: 'anonymous' })
  })
})
