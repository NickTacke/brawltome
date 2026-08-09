import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { Account, Accounts, DiscordSignInProfile } from '@brawltome/accounts'
import type { PlayerLinkRepo } from '@brawltome/identity'
import { Hono } from 'hono'
import { type CreateAuthRoutesDeps, createAuthRoutes } from '../../src/auth/routes'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const account: Account = {
  id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
  displayName: 'coolguy',
  avatarUrl: 'https://cdn.discordapp.com/avatars/discord-42/abc.png',
  createdAt: new Date('2026-08-09T18:42:01.000Z'),
}

function makeFakes() {
  const profiles: DiscordSignInProfile[] = []
  const sessions = new Set<string>()
  const accounts: Accounts = {
    async signInWithDiscord(profile) {
      profiles.push(profile)
      sessions.add('raw-session-token')
      return {
        account: { ...account, displayName: profile.displayName },
        sessionToken: 'raw-session-token',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }
    },
    async authenticate(sessionToken) {
      return sessionToken && sessions.has(sessionToken)
        ? {
            status: 'signedIn',
            account,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            extended: false,
          }
        : { status: 'anonymous' }
    },
    async signOut(sessionToken) {
      sessions.delete(sessionToken)
    },
  }
  const playerLinkRepo: PlayerLinkRepo = {
    async findByUserId() {
      return null
    },
    async findByBrawlhallaId() {
      return null
    },
    async createPending({ userId, steamId }) {
      return {
        userId,
        brawlhallaId: null,
        steamId,
        linkedVia: 'steam',
        status: 'pending',
        linkedAt: new Date(),
      }
    },
    async resolve() {},
    async setStatus() {},
    async deleteByUserId() {},
  }
  const steamLinkQueue = {
    async enqueue() {},
  } as unknown as CreateAuthRoutesDeps['steamLinkQueue']

  return { accounts, playerLinkRepo, steamLinkQueue, profiles, sessions }
}

function buildApp(fakes: ReturnType<typeof makeFakes>) {
  const app = new Hono()
  app.route(
    '/auth',
    createAuthRoutes({
      accounts: fakes.accounts,
      playerLinkRepo: fakes.playerLinkRepo,
      steamLinkQueue: fakes.steamLinkQueue,
      config: {
        discordClientId: 'cid',
        discordClientSecret: 'csecret',
        discordRedirectUri: 'http://localhost:3000/auth/discord/callback',
        webOrigin: 'http://localhost:3001',
        steamReturnUrl: 'http://localhost:3000/auth/steam/callback',
        steamRealm: 'http://localhost:3000',
      },
    }),
  )
  return app
}

describe('GET /auth/discord/login', () => {
  it('sets a state cookie and redirects to discord', async () => {
    const app = buildApp(makeFakes())

    const res = await app.request('/auth/discord/login')
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toStartWith('https://discord.com/api/oauth2/authorize')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('brawltome_oauth_state=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    const state = new URL(location).searchParams.get('state')
    expect(state).toBeTruthy()
    expect(setCookie).toContain(`brawltome_oauth_state=${state}`)
  })
})

describe('GET /auth/discord/callback', () => {
  it('error redirects when state is missing or mismatched', async () => {
    const app = buildApp(makeFakes())
    const res = await app.request('/auth/discord/callback?code=x&state=wrong', {
      headers: { cookie: 'brawltome_oauth_state=expected' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3001/account?error=state')

    const multibyte = await app.request(`/auth/discord/callback?code=x&state=${encodeURIComponent('éééééééé')}`, {
      headers: { cookie: 'brawltome_oauth_state=expected' },
    })
    expect(multibyte.status).toBe(302)
    expect(multibyte.headers.get('location')).toBe('http://localhost:3001/account?error=state')
  })

  it('maps the verified Discord profile through Accounts and preserves the session cookie', async () => {
    const fakes = makeFakes()
    const app = buildApp(fakes)
    globalThis.fetch = mock(async (url) => {
      const value = String(url)
      if (value.includes('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
      }
      if (value.includes('/users/@me')) {
        return new Response(JSON.stringify({ id: '42', username: 'coolguy', avatar: 'abc' }), { status: 200 })
      }
      return new Response('not mocked', { status: 500 })
    }) as unknown as typeof fetch

    const res = await app.request('/auth/discord/callback?code=the-code&state=expected', {
      headers: { cookie: 'brawltome_oauth_state=expected' },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3001/')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('brawltome_session=raw-session-token')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Max-Age=2592000')
    expect(fakes.profiles).toEqual([{ providerAccountId: '42', displayName: 'coolguy', avatarHash: 'abc' }])
  })

  it('redirects to the discord error state on upstream failure', async () => {
    const app = buildApp(makeFakes())
    globalThis.fetch = mock(async () => new Response('nope', { status: 400 })) as unknown as typeof fetch

    const res = await app.request('/auth/discord/callback?code=x&state=expected', {
      headers: { cookie: 'brawltome_oauth_state=expected' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3001/account?error=discord')
  })
})

describe('POST /auth/signout', () => {
  it('revokes the session through Accounts and clears the cookie', async () => {
    const fakes = makeFakes()
    fakes.sessions.add('raw-token')
    const app = buildApp(fakes)

    const res = await app.request('/auth/signout', {
      method: 'POST',
      headers: { cookie: 'brawltome_session=raw-token', origin: 'http://localhost:3001' },
    })

    expect(res.status).toBe(204)
    expect(fakes.sessions.has('raw-token')).toBe(false)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('brawltome_session=')
    expect(setCookie).toContain('Max-Age=0')
  })

  it('returns failure and preserves the cookie when revocation fails', async () => {
    const fakes = makeFakes()
    fakes.accounts.signOut = async () => {
      throw new Error('database unavailable')
    }
    const app = buildApp(fakes)

    const res = await app.request('/auth/signout', {
      method: 'POST',
      headers: { cookie: 'brawltome_session=raw-token', origin: 'http://localhost:3001' },
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'signout_failed' })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('returns 204 when there is no cookie', async () => {
    const app = buildApp(makeFakes())
    const res = await app.request('/auth/signout', {
      method: 'POST',
      headers: { origin: 'http://localhost:3001' },
    })
    expect(res.status).toBe(204)
  })

  it('rejects requests from a disallowed or missing origin', async () => {
    const app = buildApp(makeFakes())
    const disallowed = await app.request('/auth/signout', {
      method: 'POST',
      headers: { origin: 'http://evil.example.com' },
    })
    const missing = await app.request('/auth/signout', { method: 'POST' })
    expect(disallowed.status).toBe(403)
    expect(missing.status).toBe(403)
  })
})
