import { z } from 'zod'

const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize'
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token'
const DISCORD_USER_URL = 'https://discord.com/api/users/@me'

export interface BuildAuthorizeUrlParams {
  clientId: string
  redirectUri: string
  state: string
}

export function buildAuthorizeUrl(params: BuildAuthorizeUrlParams): string {
  const url = new URL(DISCORD_AUTHORIZE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'identify')
  url.searchParams.set('state', params.state)
  return url.toString()
}

export interface ExchangeCodeParams {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}

export async function exchangeCode(params: ExchangeCodeParams): Promise<{ accessToken: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  })

  const res = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Discord token exchange failed: ${res.status} ${text}`)
  }

  const data = z.object({ access_token: z.string().min(1) }).parse(await res.json())
  return { accessToken: data.access_token }
}

export interface DiscordUserProfile {
  discordId: string
  username: string
  avatarHash: string | null
}

const discordUserSchema = z.object({
  id: z.string().regex(/^\d+$/).max(64),
  username: z.string().min(1).max(64),
  avatar: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/)
    .max(128)
    .nullable(),
})

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUserProfile> {
  const res = await fetch(DISCORD_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Discord user fetch failed: ${res.status} ${text}`)
  }

  const data = discordUserSchema.parse(await res.json())
  return {
    discordId: data.id,
    username: data.username,
    avatarHash: data.avatar ?? null,
  }
}
