import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { Account, Accounts, DiscordSignInProfile } from '@brawltome/accounts'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
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
  const verificationAttempts: unknown[] = []
  const queuedVerifications: unknown[] = []
  const actorAdmissions: unknown[] = []
  let admissionOutcome: 'admitted' | 'rate-limited' = 'admitted'
  let operationOutcome: 'accepted' | 'already-active' = 'accepted'
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
    async getPreferences() {
      return { version: 1, leaderboardBracket: '1v1', leaderboardRegion: 'all' }
    },
    async updatePreferences(_accountId, preferences) {
      return preferences
    },
    async beginPrimaryPlayerVerification(input) {
      verificationAttempts.push(input)
      return {
        id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
        status: 'pending',
        startedAt: new Date(),
        completedAt: null,
        player: null,
      }
    },
    async resolvePrimaryPlayerVerification() {
      throw new Error('not used')
    },
    async getPrimaryPlayerVerificationState() {
      return { primaryPlayer: null, attempts: [] }
    },
  }
  const requestAdmission = {
    async admitActor(actor: unknown, reservationKey?: string) {
      actorAdmissions.push({ actor, reservationKey })
      return admissionOutcome === 'admitted'
        ? ({ outcome: 'admitted' } as const)
        : ({ outcome: 'rate-limited', retryAfterSeconds: 60 } as const)
    },
    async hasActorReservation() {
      return false
    },
  }
  const verificationOperations: CreateAuthRoutesDeps['verificationOperations'] = {
    async accept(input) {
      queuedVerifications.push(input)
      return { outcome: operationOutcome, operationId: 'operation-1' }
    },
  }

  return {
    accounts,
    requestAdmission,
    verificationOperations,
    profiles,
    sessions,
    verificationAttempts,
    queuedVerifications,
    actorAdmissions,
    setAdmissionOutcome(outcome: 'admitted' | 'rate-limited') {
      admissionOutcome = outcome
    },
    setOperationOutcome(outcome: 'accepted' | 'already-active') {
      operationOutcome = outcome
    },
  }
}

function buildApp(
  fakes: ReturnType<typeof makeFakes>,
  observeSourceCall?: CreateAuthRoutesDeps['observeSourceCall'],
  logger?: CreateAuthRoutesDeps['logger'],
) {
  const app = new Hono()
  app.route(
    '/auth',
    createAuthRoutes({
      accounts: fakes.accounts,
      requestAdmission: fakes.requestAdmission,
      verificationOperations: fakes.verificationOperations,
      observeSourceCall,
      logger,
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
    const observedDomains: string[] = []
    const app = buildApp(fakes, async (domain, work) => {
      observedDomains.push(domain)
      return work()
    })
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
    expect(observedDomains).toEqual(['discord', 'discord'])
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

  it('does not put Discord OAuth response bodies or tokens into normalized telemetry', async () => {
    const canary = 'oauth-private-token-canary'
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'auth-test', sink, drainIntervalMs: 0 })
    const app = buildApp(makeFakes(), undefined, telemetry.logger)
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ access_token: canary, private_payload: canary }), { status: 400 }),
    ) as unknown as typeof fetch

    const res = await app.request('/auth/discord/callback?code=x&state=expected', {
      headers: { cookie: 'brawltome_oauth_state=expected' },
    })
    await telemetry.flush(50)
    const output = JSON.stringify(sink.records)

    expect(res.status).toBe(302)
    expect(output).toContain('auth.discord_token_exchange.failed')
    expect(output).not.toContain(canary)
    expect(output).not.toContain('private_payload')
  })
})

function steamCallbackUrl(state: string): URL {
  const callback = new URL('http://localhost/auth/steam/callback')
  const claimedId = 'https://steamcommunity.com/openid/id/76561198000000000'
  callback.searchParams.set('state', state)
  callback.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0')
  callback.searchParams.set('openid.mode', 'id_res')
  callback.searchParams.set('openid.signed', 'op_endpoint,claimed_id,identity,return_to,response_nonce')
  callback.searchParams.set('openid.op_endpoint', 'https://steamcommunity.com/openid/login')
  callback.searchParams.set('openid.return_to', `http://localhost:3000/auth/steam/callback?state=${state}`)
  callback.searchParams.set('openid.claimed_id', claimedId)
  callback.searchParams.set('openid.identity', claimedId)
  callback.searchParams.set('openid.response_nonce', `${new Date().toISOString().slice(0, 19)}Znonce`)
  return callback
}

describe('GET /auth/steam/callback', () => {
  it('uses authenticated account admission without Turnstile and queues one privacy-safe attempt', async () => {
    const fakes = makeFakes()
    fakes.sessions.add('raw-session-token')
    const observedDomains: string[] = []
    const app = buildApp(fakes, async (domain, work) => {
      observedDomains.push(domain)
      return work()
    })
    const start = await app.request('/auth/steam/link', {
      headers: { cookie: 'brawltome_session=raw-session-token' },
    })
    const stateCookie = start.headers.get('set-cookie') ?? ''
    const state = /brawltome_steam_state=([^;]+)/.exec(stateCookie)?.[1]
    if (!state) throw new Error('Expected Steam state cookie')
    globalThis.fetch = mock(async () => new Response('is_valid:true', { status: 200 })) as unknown as typeof fetch

    const response = await app.request(steamCallbackUrl(state).toString(), {
      headers: {
        cookie: `brawltome_session=raw-session-token; brawltome_steam_state=${state}`,
        'x-client-ip': '203.0.113.10',
      },
    })

    expect(response.headers.get('location')).toBe('http://localhost:3001/account')
    expect(observedDomains).toEqual(['steam'])
    expect(fakes.actorAdmissions).toEqual([
      {
        actor: { kind: 'authenticated', accountId: account.id, ip: '203.0.113.10' },
        reservationKey: expect.stringMatching(/^primary-player:[a-f0-9]{64}$/),
      },
    ])
    expect(fakes.verificationAttempts).toEqual([
      {
        accountId: account.id,
        steamId: '76561198000000000',
        idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ])
    expect(fakes.queuedVerifications).toEqual([
      {
        kind: 'proof',
        dedupeKey: 'primary-player:5f689990-dc60-4d70-bd1c-7b49b89786b7',
        operationKey: 'primary-player:5f689990-dc60-4d70-bd1c-7b49b89786b7',
        workClass: 'interactive',
        payload: { value: '5f689990-dc60-4d70-bd1c-7b49b89786b7' },
        provenance: { source: 'steam-openid', requestedBy: account.id },
        maxAttempts: 3,
      },
    ])
  })

  it('treats an already-active durable verification as an idempotent success', async () => {
    const fakes = makeFakes()
    fakes.sessions.add('raw-session-token')
    fakes.setOperationOutcome('already-active')
    const app = buildApp(fakes)
    const start = await app.request('/auth/steam/link', {
      headers: { cookie: 'brawltome_session=raw-session-token' },
    })
    const state = /brawltome_steam_state=([^;]+)/.exec(start.headers.get('set-cookie') ?? '')?.[1]
    if (!state) throw new Error('Expected Steam state cookie')
    globalThis.fetch = mock(async () => new Response('is_valid:true', { status: 200 })) as unknown as typeof fetch

    const response = await app.request(steamCallbackUrl(state).toString(), {
      headers: { cookie: `brawltome_session=raw-session-token; brawltome_steam_state=${state}` },
    })

    expect(response.headers.get('location')).toBe('http://localhost:3001/account')
    expect(fakes.queuedVerifications).toHaveLength(1)
  })

  it('rejects a signed Steam response that is not bound to the current callback state', async () => {
    const fakes = makeFakes()
    fakes.sessions.add('raw-session-token')
    const app = buildApp(fakes)
    const start = await app.request('/auth/steam/link', {
      headers: { cookie: 'brawltome_session=raw-session-token' },
    })
    const state = /brawltome_steam_state=([^;]+)/.exec(start.headers.get('set-cookie') ?? '')?.[1]
    if (!state) throw new Error('Expected Steam state cookie')
    const replay = steamCallbackUrl(state)
    replay.searchParams.set('openid.return_to', 'http://localhost:3000/auth/steam/callback?state=captured-old-state')
    globalThis.fetch = mock(async () => new Response('is_valid:true', { status: 200 })) as unknown as typeof fetch

    const response = await app.request(replay.toString(), {
      headers: { cookie: `brawltome_session=raw-session-token; brawltome_steam_state=${state}` },
    })

    expect(response.headers.get('location')).toBe('http://localhost:3001/account?error=steam')
    expect(fakes.actorAdmissions).toEqual([])
    expect(fakes.verificationAttempts).toEqual([])
  })

  it('remains account and IP rate-limited without creating an attempt', async () => {
    const fakes = makeFakes()
    fakes.sessions.add('raw-session-token')
    fakes.setAdmissionOutcome('rate-limited')
    const app = buildApp(fakes)
    const start = await app.request('/auth/steam/link', {
      headers: { cookie: 'brawltome_session=raw-session-token' },
    })
    const state = /brawltome_steam_state=([^;]+)/.exec(start.headers.get('set-cookie') ?? '')?.[1]
    if (!state) throw new Error('Expected Steam state cookie')
    globalThis.fetch = mock(async () => new Response('is_valid:true', { status: 200 })) as unknown as typeof fetch

    const response = await app.request(steamCallbackUrl(state).toString(), {
      headers: {
        cookie: `brawltome_session=raw-session-token; brawltome_steam_state=${state}`,
        'x-client-ip': '203.0.113.10',
      },
    })

    expect(response.headers.get('location')).toBe('http://localhost:3001/account?error=rate_limited')
    expect(fakes.verificationAttempts).toEqual([])
    expect(fakes.queuedVerifications).toEqual([])
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
