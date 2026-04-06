import { describe, expect, it } from 'bun:test'
import {
  SESSION_EXTEND_THRESHOLD_MS,
  SESSION_TTL_MS,
  getCurrentUser,
  hashSessionToken,
  signOut,
} from '@brawltome/identity'
import type { Session, SessionRepo, UserRepo, UserWithPrimaryAccount } from '@brawltome/identity'

function makeUser(id = 'user-1'): UserWithPrimaryAccount {
  const now = new Date()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    primaryAccount: {
      userId: id,
      provider: 'discord',
      providerAccountId: '12345',
      username: 'coolguy',
      avatarHash: null,
      refreshToken: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

function makeFakes(initialSessions: Session[] = [], users: UserWithPrimaryAccount[] = [makeUser()]) {
  const sessions = [...initialSessions]
  const userRepo: UserRepo = {
    async findByDiscordId() {
      return null
    },
    async findById(id) {
      return users.find((u) => u.id === id) ?? null
    },
    async upsertDiscordUser() {
      throw new Error('not used')
    },
  }
  const sessionRepo: SessionRepo = {
    async create(row) {
      const full: Session = { ...row, createdAt: new Date() }
      sessions.push(full)
      return full
    },
    async findById(id) {
      return sessions.find((s) => s.id === id) ?? null
    },
    async deleteById(id) {
      const i = sessions.findIndex((s) => s.id === id)
      if (i >= 0) sessions.splice(i, 1)
    },
    async extend(id, expiresAt) {
      const row = sessions.find((s) => s.id === id)
      if (row) row.expiresAt = expiresAt
    },
    async deleteExpired() {
      return 0
    },
  }
  return { userRepo, sessionRepo, sessions }
}

describe('getCurrentUser', () => {
  it('returns null when there is no token', async () => {
    const { userRepo, sessionRepo } = makeFakes()
    const result = await getCurrentUser({ userRepo, sessionRepo }, null)
    expect(result).toBeNull()
  })

  it('returns null when the token does not match any session', async () => {
    const { userRepo, sessionRepo } = makeFakes()
    const result = await getCurrentUser({ userRepo, sessionRepo }, 'unknown-token')
    expect(result).toBeNull()
  })

  it('returns null when the session is expired', async () => {
    const raw = 'raw-token'
    const expired: Session = {
      id: hashSessionToken(raw),
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    }
    const { userRepo, sessionRepo } = makeFakes([expired])
    const result = await getCurrentUser({ userRepo, sessionRepo }, raw)
    expect(result).toBeNull()
  })

  it('returns the user when the session is valid', async () => {
    const raw = 'raw-token'
    const valid: Session = {
      id: hashSessionToken(raw),
      userId: 'user-1',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      createdAt: new Date(),
    }
    const { userRepo, sessionRepo } = makeFakes([valid])
    const result = await getCurrentUser({ userRepo, sessionRepo }, raw)
    expect(result).not.toBeNull()
    expect(result?.user.id).toBe('user-1')
    expect(result?.extended).toBe(false)
  })

  it('extends the session when it is within the threshold window', async () => {
    const raw = 'raw-token'
    const nearExpiry: Session = {
      id: hashSessionToken(raw),
      userId: 'user-1',
      // 3 days out — inside the 7-day extend threshold
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    }
    const { userRepo, sessionRepo, sessions } = makeFakes([nearExpiry])
    const result = await getCurrentUser({ userRepo, sessionRepo }, raw)

    expect(result?.extended).toBe(true)
    const extended = sessions[0].expiresAt.getTime()
    expect(extended - Date.now()).toBeGreaterThanOrEqual(SESSION_TTL_MS - 1000)
  })
})

describe('signOut', () => {
  it('deletes the session row for the given raw token', async () => {
    const raw = 'raw-token'
    const row: Session = {
      id: hashSessionToken(raw),
      userId: 'user-1',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      createdAt: new Date(),
    }
    const { sessionRepo, sessions } = makeFakes([row])
    await signOut({ sessionRepo }, raw)
    expect(sessions).toHaveLength(0)
  })

  it('is a no-op for unknown tokens', async () => {
    const { sessionRepo } = makeFakes()
    await signOut({ sessionRepo }, 'whatever')
  })
})
