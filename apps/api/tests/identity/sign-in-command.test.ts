import { describe, expect, it } from 'bun:test'
import { signInWithDiscord } from '@brawltome/identity'
import type { SessionRepo, UserRepo } from '@brawltome/identity'
import type { Session, UserWithPrimaryAccount } from '@brawltome/identity'

function fakeUserRepo(): UserRepo & { calls: { upsert: unknown[] } } {
  const calls = { upsert: [] as unknown[] }
  return {
    calls,
    async findByDiscordId() {
      return null
    },
    async findById() {
      return null
    },
    async upsertDiscordUser(profile) {
      calls.upsert.push(profile)
      const now = new Date()
      return {
        id: 'user-1',
        createdAt: now,
        updatedAt: now,
        primaryAccount: {
          userId: 'user-1',
          provider: 'discord',
          providerAccountId: profile.discordId,
          username: profile.username,
          avatarHash: profile.avatarHash,
          refreshToken: null,
          createdAt: now,
          updatedAt: now,
        },
      } satisfies UserWithPrimaryAccount
    },
  }
}

function fakeSessionRepo(): SessionRepo & { rows: Session[] } {
  const rows: Session[] = []
  return {
    rows,
    async create({ id, userId, expiresAt }) {
      const row: Session = { id, userId, expiresAt, createdAt: new Date() }
      rows.push(row)
      return row
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null
    },
    async deleteById(id) {
      const i = rows.findIndex((r) => r.id === id)
      if (i >= 0) rows.splice(i, 1)
    },
    async extend(id, expiresAt) {
      const row = rows.find((r) => r.id === id)
      if (row) row.expiresAt = expiresAt
    },
    async deleteExpired() {
      return 0
    },
  }
}

describe('signInWithDiscord', () => {
  it('upserts the user, creates a session, and returns the raw token', async () => {
    const userRepo = fakeUserRepo()
    const sessionRepo = fakeSessionRepo()

    const result = await signInWithDiscord(
      { userRepo, sessionRepo },
      { discordId: '12345', username: 'coolguy', avatarHash: 'abc' },
    )

    expect(userRepo.calls.upsert).toHaveLength(1)
    expect(result.user.id).toBe('user-1')
    expect(result.user.primaryAccount.username).toBe('coolguy')
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(sessionRepo.rows).toHaveLength(1)
    // Session row must store the HASH, not the raw token
    expect(sessionRepo.rows[0].id).not.toBe(result.rawToken)
    expect(sessionRepo.rows[0].id).toMatch(/^[a-f0-9]{64}$/)
  })

  it('sets expiresAt ~30 days from now', async () => {
    const userRepo = fakeUserRepo()
    const sessionRepo = fakeSessionRepo()
    const before = Date.now()

    await signInWithDiscord(
      { userRepo, sessionRepo },
      { discordId: '12345', username: 'x', avatarHash: null },
    )

    const expiresAt = sessionRepo.rows[0].expiresAt.getTime()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    expect(expiresAt - before).toBeGreaterThanOrEqual(thirtyDays - 1000)
    expect(expiresAt - before).toBeLessThanOrEqual(thirtyDays + 1000)
  })
})
