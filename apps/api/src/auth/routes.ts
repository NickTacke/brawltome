import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Accounts, PrimaryPlayerVerificationAttempt } from '@brawltome/accounts'
import type { AcceptOperationResult, AcceptProofOperation } from '@brawltome/refresh-operations'
import type { ActorAdmission } from '@brawltome/request-admission'
import { Hono } from 'hono'
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_COOKIE_TTL_SEC,
  STEAM_STATE_COOKIE,
  buildSessionCookie,
  buildStateCookie,
  buildSteamStateCookie,
  clearSessionCookie,
  clearStateCookie,
  clearSteamStateCookie,
  parseCookies,
} from './cookies'
import { buildAuthorizeUrl, exchangeCode, fetchDiscordUser } from './discord'
import { buildSteamLoginUrl, verifySteamLogin } from './steam'

export interface AuthConfig {
  discordClientId: string
  discordClientSecret: string
  discordRedirectUri: string
  webOrigin: string
  steamReturnUrl: string
  steamRealm: string
}

export interface CreateAuthRoutesDeps {
  accounts: Accounts
  requestAdmission: ActorAdmission
  verificationOperations: {
    accept(input: AcceptProofOperation): Promise<AcceptOperationResult>
  }
  config: AuthConfig
}

function normalizeOrigin(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

function stateMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided)
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
}

export function createAuthRoutes(deps: CreateAuthRoutesDeps): Hono {
  const app = new Hono()
  const { accounts, requestAdmission, verificationOperations, config } = deps
  const expectedOrigin = normalizeOrigin(config.webOrigin)

  app.get('/discord/login', (c) => {
    const state = randomBytes(32).toString('base64url')
    c.header('Set-Cookie', buildStateCookie(state))
    return c.redirect(
      buildAuthorizeUrl({
        clientId: config.discordClientId,
        redirectUri: config.discordRedirectUri,
        state,
      }),
    )
  })

  app.get('/discord/callback', async (c) => {
    const cookies = parseCookies(c.req.header('cookie'))
    const expected = cookies[OAUTH_STATE_COOKIE]
    const provided = c.req.query('state')
    const code = c.req.query('code')

    const stateValid = stateMatches(expected, provided)

    if (!stateValid || !code) {
      c.header('Set-Cookie', clearStateCookie())
      return c.redirect(`${config.webOrigin}/account?error=state`)
    }

    c.header('Set-Cookie', clearStateCookie())

    let accessToken: string
    try {
      const exchange = await exchangeCode({
        clientId: config.discordClientId,
        clientSecret: config.discordClientSecret,
        redirectUri: config.discordRedirectUri,
        code,
      })
      accessToken = exchange.accessToken
    } catch (err) {
      console.error('[auth] discord token exchange failed', err)
      return c.redirect(`${config.webOrigin}/account?error=discord`)
    }

    let profile: Awaited<ReturnType<typeof fetchDiscordUser>>
    try {
      profile = await fetchDiscordUser(accessToken)
    } catch (err) {
      console.error('[auth] discord user fetch failed', err)
      return c.redirect(`${config.webOrigin}/account?error=discord`)
    }

    try {
      const { sessionToken } = await accounts.signInWithDiscord({
        providerAccountId: profile.discordId,
        displayName: profile.username,
        avatarHash: profile.avatarHash,
      })
      c.header('Set-Cookie', buildSessionCookie(sessionToken, SESSION_COOKIE_TTL_SEC), { append: true })
    } catch (err) {
      console.error('[auth] signInWithDiscord failed', err)
      return c.redirect(`${config.webOrigin}/account?error=server`)
    }

    return c.redirect(`${config.webOrigin}/`)
  })

  app.post('/signout', async (c) => {
    const origin = normalizeOrigin(c.req.header('origin'))
    if (origin !== expectedOrigin) {
      console.warn('[auth] signout rejected: origin mismatch', { origin, expected: expectedOrigin })
      return c.json({ error: 'csrf' }, 403)
    }

    const cookies = parseCookies(c.req.header('cookie'))
    const raw = cookies[SESSION_COOKIE]
    if (raw) {
      try {
        await accounts.signOut(raw)
      } catch (err) {
        console.error('[auth] signOut failed', err)
        return c.json({ error: 'signout_failed' }, 500)
      }
    }
    c.header('Set-Cookie', clearSessionCookie())
    return c.body(null, 204)
  })

  app.get('/steam/link', (c) => {
    const cookies = parseCookies(c.req.header('cookie'))
    const rawToken = cookies[SESSION_COOKIE]
    if (!rawToken) {
      return c.redirect(`${config.webOrigin}/account?error=auth`)
    }

    const state = randomBytes(32).toString('base64url')
    c.header('Set-Cookie', buildSteamStateCookie(state))
    return c.redirect(
      buildSteamLoginUrl({
        returnUrl: `${config.steamReturnUrl}?state=${state}`,
        realm: config.steamRealm,
      }),
    )
  })

  app.get('/steam/callback', async (c) => {
    const cookies = parseCookies(c.req.header('cookie'))
    const rawToken = cookies[SESSION_COOKIE]
    if (!rawToken) {
      return c.redirect(`${config.webOrigin}/account?error=auth`)
    }

    const expectedState = cookies[STEAM_STATE_COOKIE]
    const providedState = c.req.query('state')
    const stateValid = stateMatches(expectedState, providedState)

    c.header('Set-Cookie', clearSteamStateCookie())

    if (!stateValid) {
      return c.redirect(`${config.webOrigin}/account?error=state`)
    }

    // Collect all openid.* params
    const openidParams: Record<string, string> = {}
    for (const [key, value] of Object.entries(c.req.query())) {
      if (key.startsWith('openid.') && typeof value === 'string') {
        openidParams[key] = value
      }
    }

    let steamId: string | null
    try {
      steamId = await verifySteamLogin(openidParams, `${config.steamReturnUrl}?state=${providedState}`)
    } catch (err) {
      console.error('[auth] steam verification failed', err)
      return c.redirect(`${config.webOrigin}/account?error=steam`)
    }

    if (!steamId) {
      return c.redirect(`${config.webOrigin}/account?error=steam`)
    }

    const authentication = await accounts.authenticate(rawToken)
    if (authentication.status === 'anonymous') {
      return c.redirect(`${config.webOrigin}/account?error=auth`)
    }

    const responseNonce = openidParams['openid.response_nonce']
    if (!responseNonce) {
      return c.redirect(`${config.webOrigin}/account?error=steam`)
    }

    const idempotencyKey = createHash('sha256').update(responseNonce).digest('hex')
    const clientIp = c.req.header('cf-connecting-ip') ?? 'unknown'
    const admissionKey = createHash('sha256')
      .update(`${authentication.account.id}:${clientIp}:${idempotencyKey}`)
      .digest('hex')
    const admission = await requestAdmission.admitActor(
      { kind: 'authenticated', accountId: authentication.account.id, ip: clientIp },
      `primary-player:${admissionKey}`,
    )
    if (admission.outcome === 'rate-limited') {
      return c.redirect(`${config.webOrigin}/account?error=rate_limited`)
    }

    let attempt: PrimaryPlayerVerificationAttempt
    try {
      attempt = await accounts.beginPrimaryPlayerVerification({
        accountId: authentication.account.id,
        steamId,
        idempotencyKey,
      })
    } catch (err) {
      console.error('[auth] Primary Player verification attempt failed', err)
      return c.redirect(`${config.webOrigin}/account?error=server`)
    }

    if (attempt.status === 'pending') {
      const operation = await verificationOperations.accept({
        kind: 'proof',
        dedupeKey: `primary-player:${attempt.id}`,
        operationKey: `primary-player:${attempt.id}`,
        workClass: 'interactive',
        payload: { value: attempt.id },
        provenance: { source: 'steam-openid', requestedBy: authentication.account.id },
        maxAttempts: 3,
      })
      if (operation.outcome === 'already-active') return c.redirect(`${config.webOrigin}/account`)
    }
    return c.redirect(`${config.webOrigin}/account`)
  })

  return app
}
