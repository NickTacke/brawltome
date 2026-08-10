import { describe, expect, test } from 'bun:test'
import type { AccountsStore, PrimaryPlayerVerificationAttempt, PrimaryPlayerVerificationState } from '../src/accounts'
import { createAccounts } from '../src/accounts'

const accountId = '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295'
const startedAt = new Date('2026-08-10T10:00:00.000Z')

function createStore(): AccountsStore {
  const attempts = new Map<string, PrimaryPlayerVerificationAttempt>()
  const steamIds = new Map<string, string>()
  const idempotency = new Map<string, { accountId: string; attemptId: string }>()
  let state: PrimaryPlayerVerificationState = { primaryPlayer: null, attempts: [] }

  return {
    async upsertDiscordIdentity() {
      throw new Error('not used')
    },
    async createSession() {},
    async findSessionAccount() {
      return null
    },
    async extendSession() {},
    async deleteSession() {},
    async findPreferences() {
      return null
    },
    async upsertPreferences(_accountId, preferences) {
      return preferences
    },
    async beginPrimaryPlayerVerification(input) {
      const existing = idempotency.get(input.idempotencyKey)
      if (existing?.accountId !== undefined && existing.accountId !== input.accountId) {
        throw new Error('Steam proof was already used by another account')
      }
      if (existing) return attempts.get(existing.attemptId) as PrimaryPlayerVerificationAttempt
      const attempt: PrimaryPlayerVerificationAttempt = {
        id: input.attemptId,
        status: 'pending',
        startedAt: input.startedAt,
        completedAt: null,
        player: null,
      }
      attempts.set(attempt.id, attempt)
      steamIds.set(attempt.id, input.steamId)
      idempotency.set(input.idempotencyKey, { accountId: input.accountId, attemptId: attempt.id })
      state = { ...state, attempts: [attempt, ...state.attempts] }
      return attempt
    },
    async findPrimaryPlayerVerificationAttempt(attemptId) {
      const attempt = attempts.get(attemptId)
      const steamId = steamIds.get(attemptId)
      return attempt && steamId ? { attempt, steamId } : null
    },
    async completePrimaryPlayerVerification(input) {
      const current = attempts.get(input.attemptId)
      if (!current) throw new Error('Unknown Primary Player verification attempt')
      if (current.status !== 'pending') return current
      const attempt: PrimaryPlayerVerificationAttempt = input.evidence
        ? {
            ...current,
            status: 'verified',
            completedAt: input.completedAt,
            player: { brawlhallaId: input.evidence.brawlhallaId, name: input.evidence.name },
          }
        : { ...current, status: 'failed', completedAt: input.completedAt }
      attempts.set(attempt.id, attempt)
      state = {
        primaryPlayer:
          attempt.status === 'verified' && input.evidence
            ? {
                brawlhallaId: input.evidence.brawlhallaId,
                name: input.evidence.name,
                verifiedAt: input.completedAt,
              }
            : state.primaryPlayer,
        attempts: state.attempts.map((item) => (item.id === attempt.id ? attempt : item)),
      }
      return attempt
    },
    async getPrimaryPlayerVerificationState() {
      return state
    },
    async readPrimaryMonitoringSnapshot() {
      return {
        observedAt: startedAt,
        targets: state.primaryPlayer
          ? [{ assignmentId: '5f689990-dc60-4d70-bd1c-7b49b89786b7', ...state.primaryPlayer }]
          : [],
      }
    },
  }
}

describe('Primary Player verification', () => {
  test('creates one pending attempt for repeated proof delivery', async () => {
    const accounts = createAccounts({
      store: createStore(),
      now: () => startedAt,
      generateId: () => '5f689990-dc60-4d70-bd1c-7b49b89786b7',
    })

    const first = await accounts.beginPrimaryPlayerVerification({
      accountId,
      steamId: '76561198000000000',
      idempotencyKey: 'openid-response-nonce',
    })
    const replay = await accounts.beginPrimaryPlayerVerification({
      accountId,
      steamId: '76561198000000000',
      idempotencyKey: 'openid-response-nonce',
    })

    expect(replay).toEqual(first)
    expect((await accounts.getPrimaryPlayerVerificationState(accountId)).attempts).toHaveLength(1)
  })

  test('records failed evidence without changing ownership and completion is idempotent', async () => {
    const accounts = createAccounts({
      store: createStore(),
      now: () => startedAt,
      generateId: () => '5f689990-dc60-4d70-bd1c-7b49b89786b7',
    })
    const attempt = await accounts.beginPrimaryPlayerVerification({
      accountId,
      steamId: '76561198000000000',
      idempotencyKey: 'nonce',
    })

    const failed = await accounts.resolvePrimaryPlayerVerification(attempt.id, { resolve: async () => null })
    const replay = await accounts.resolvePrimaryPlayerVerification(attempt.id, {
      resolve: async () => ({
        brawlhallaId: 42,
        name: 'Ada',
        checkedAt: new Date('2026-08-10T10:01:00.000Z'),
        source: 'brawlhalla-v0-steam-search',
      }),
    })

    expect(failed.status).toBe('failed')
    expect(replay).toEqual(failed)
    expect((await accounts.getPrimaryPlayerVerificationState(accountId)).primaryPlayer).toBeNull()
  })
})
