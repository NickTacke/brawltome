import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { SessionRepo, UserRepo, UserWithPrimaryAccount } from '@brawltome/identity'
import { Hono } from 'hono'
import { createAuthRoutes } from '../../src/auth/routes'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function makeUser(): UserWithPrimaryAccount {
  const now = new Date()
  return {
    id: 'user-1',
    createdAt: now,
    updatedAt: now,
    primaryAccount: {
      userId: 'user-1',
      provider: 'discord',
      providerAccountId: 'discord-42',
      username: 'coolguy',
      avatarHash: 'abc',
      refreshToken: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

function makeFakes() {
  const users: UserWithPrimaryAccount[] = []
  const sessions: Array<{ id: string; userId: string; expiresAt: Date; createdAt: Date }> = []

  const userRepo: UserRepo = {
    async findByDiscordId() {
      return null
    },
    async findById(id) {
      return users.find((u) => u.id === id) ?? null
    },
    async upsertDiscordUser(profile) {
      let u = users[0]
      if (!u) {
        u = makeUser()
        u.primaryAccount.providerAccountId = profile.discordId
        u.primaryAccount.username = profile.username
        u.primaryAccount.avatarHash = profile.avatarHash
        users.push(u)
      }
      return u
    },
  }
  const sessionRepo: SessionRepo = {
    async create(row) {
      const full = { ...row, createdAt: new Date() }
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
    async extend() {},
    async deleteExpired() {
      return 0
    },
  }

  return { userRepo, sessionRepo, users, sessions }
}

function buildApp(fakes: ReturnType<typeof makeFakes>) {
  const app = new Hono()
  app.route(
    '/auth',
    createAuthRoutes({
      userRepo: fakes.userRepo,
      sessionRepo: fakes.sessionRepo,
      config: {
        discordClientId: 'cid',
        discordClientSecret: 'csecret',
        discordRedirectUri: 'http://localhost:3000/auth/discord/callback',
        webOrigin: 'http://localhost:3001',
      },
    }),
  )
  return app
}

describe('GET /auth/discord/login', () => {
  it('sets a state cookie and redirects to discord', async () => {
    const fakes = makeFakes()
    const app = buildApp(fakes)

    const res = await app.request('/auth/discord/login')
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toStartWith('https://discord.com/api/oauth2/authorize')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('brawltome_oauth_state=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    // state param in the redirect must match the cookie value
    const state = new URL(location).searchParams.get('state')
    expect(state).toBeTruthy()
    expect(setCookie).toContain(`brawltome_oauth_state=${state}`)
  })
})

describe('GET /auth/discord/callback', () => {
  it('errors redirects when state is missing or mismatched', async () => {
    const fakes = makeFakes()
    const app = buildApp(fakes)

    const res = await app.request('/auth/discord/callback?code=x&state=wrong', {
      headers: { cookie: 'brawltome_oauth_state=expected' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3001/account?error=state')
  })

  it('exchanges code, upserts user, creates session, sets cookie, and redirects', async () => {
    const fakes = makeFakes()
    const app = buildApp(fakes)

    globalThis.fetch = mock(async (url) => {
      const u = String(url)
      if (u.includes('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
      }
      if (u.includes('/users/@me')) {
        return new Response(JSON.stringify({ id: 'discord-42', username: 'coolguy', avatar: 'abc' }), { status: 200 })
      }
      return new Response('not mocked', { status: 500 })
    }) as unknown as typeof fetch

    const res = await app.request('/auth/discord/callback?code=the-code&state=expected', {
      headers: { cookie: 'brawltome_oauth_state=expected' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3001/')

    // Session cookie set
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('brawltome_session=')
    expect(setCookie).toContain('HttpOnly')

    // User + session created
    expect(fakes.users).toHaveLength(1)
    expect(fakes.sessions).toHaveLength(1)
  })

  it('redirects to the discord error state on upstream failure', async () => {
    const fakes = makeFakes()
    const app = buildApp(fakes)

    globalThis.fetch = mock(async () => new Response('nope', { status: 400 })) as unknown as typeof fetch

    const res = await app.request('/auth/discord/callback?code=x&state=expected', {
      headers: { cookie: 'brawltome_oauth_state=expected' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3001/account?error=discord')
  })
})

describe('POST /auth/signout', () => {
  it('deletes the session and clears the cookie', async () => {
    const fakes = makeFakes()
    const app = buildApp(fakes)
    const { hashSessionToken } = await import('@brawltome/identity')
    const raw = 'raw-token'
    fakes.sessions.push({
      id: hashSessionToken(raw),
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 1_000_000),
      createdAt: new Date(),
    })

    const res = await app.request('/auth/signout', {
      method: 'POST',
      headers: { cookie: `brawltome_session=${raw}` },
    })
    expect(res.status).toBe(204)
    expect(fakes.sessions).toHaveLength(0)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('brawltome_session=')
    expect(setCookie).toContain('Max-Age=0')
  })

  it('returns 204 even when there is no cookie', async () => {
    const fakes = makeFakes()
    const app = buildApp(fakes)
    const res = await app.request('/auth/signout', { method: 'POST' })
    expect(res.status).toBe(204)
  })
})
