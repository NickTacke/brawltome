import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { PlayerLinkRepo, SessionRepo, UserRepo } from '@brawltome/identity'
import {
  PlayerAlreadyLinkedError,
  SESSION_TTL_MS,
  hashSessionToken,
  linkPlayer,
  signInWithDiscord,
  signOut,
} from '@brawltome/identity'
import type { Queue } from '@brawltome/shared'
import { Hono } from 'hono'
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
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
  userRepo: UserRepo
  sessionRepo: SessionRepo
  playerLinkRepo: PlayerLinkRepo
  steamLinkQueue: Queue<{ userId: string; steamId: string; caller: 'background' }>
  config: AuthConfig
}

export function createAuthRoutes(deps: CreateAuthRoutesDeps): Hono {
  const app = new Hono()
  const { userRepo, sessionRepo, playerLinkRepo, steamLinkQueue, config } = deps

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

    const stateValid =
      !!expected &&
      !!provided &&
      expected.length === provided.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(provided))

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
      const { rawToken } = await signInWithDiscord({ userRepo, sessionRepo }, profile)
      c.header('Set-Cookie', buildSessionCookie(rawToken, SESSION_TTL_MS / 1000), { append: true })
    } catch (err) {
      console.error('[auth] signInWithDiscord failed', err)
      return c.redirect(`${config.webOrigin}/account?error=server`)
    }

    return c.redirect(`${config.webOrigin}/`)
  })

  app.post('/signout', async (c) => {
    // CSRF protection: require a custom header that cross-site forms cannot set.
    // Session cookie is SameSite=Lax (required for OAuth redirect), so without this
    // check, a cross-site form could log the user out.
    if (c.req.header('x-requested-with') !== 'brawltome') {
      return c.json({ error: 'csrf' }, 403)
    }

    const cookies = parseCookies(c.req.header('cookie'))
    const raw = cookies[SESSION_COOKIE]
    if (raw) {
      try {
        await signOut({ sessionRepo }, raw)
      } catch (err) {
        console.error('[auth] signOut failed', err)
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
    const stateValid =
      !!expectedState &&
      !!providedState &&
      expectedState.length === providedState.length &&
      timingSafeEqual(Buffer.from(expectedState), Buffer.from(providedState))

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
      steamId = await verifySteamLogin(openidParams)
    } catch (err) {
      console.error('[auth] steam verification failed', err)
      return c.redirect(`${config.webOrigin}/account?error=steam`)
    }

    if (!steamId) {
      return c.redirect(`${config.webOrigin}/account?error=steam`)
    }

    // Resolve session to get userId
    const hashedToken = hashSessionToken(rawToken)
    const session = await sessionRepo.findById(hashedToken)
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return c.redirect(`${config.webOrigin}/account?error=auth`)
    }

    try {
      await linkPlayer({ playerLinkRepo }, { userId: session.userId, steamId })
    } catch (err) {
      console.error('[auth] linkPlayer failed', err)
      const isAlreadyLinked = err instanceof PlayerAlreadyLinkedError
      return c.redirect(`${config.webOrigin}/account?error=${isAlreadyLinked ? 'already_linked' : 'server'}`)
    }

    await steamLinkQueue.enqueue({ userId: session.userId, steamId, caller: 'background' })
    return c.redirect(`${config.webOrigin}/account`)
  })

  return app
}
