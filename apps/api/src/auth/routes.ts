import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { SessionRepo, UserRepo } from '@brawltome/identity'
import { SESSION_TTL_MS, signInWithDiscord, signOut } from '@brawltome/identity'
import { Hono } from 'hono'
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  buildSessionCookie,
  buildStateCookie,
  clearSessionCookie,
  clearStateCookie,
  parseCookies,
} from './cookies'
import { buildAuthorizeUrl, exchangeCode, fetchDiscordUser } from './discord'

export interface AuthConfig {
  discordClientId: string
  discordClientSecret: string
  discordRedirectUri: string
  webOrigin: string
}

export interface CreateAuthRoutesDeps {
  userRepo: UserRepo
  sessionRepo: SessionRepo
  config: AuthConfig
}

export function createAuthRoutes(deps: CreateAuthRoutesDeps): Hono {
  const app = new Hono()
  const { userRepo, sessionRepo, config } = deps

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

  return app
}
