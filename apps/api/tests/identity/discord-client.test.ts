import { afterEach, describe, expect, it, mock } from 'bun:test'
import { buildAuthorizeUrl, exchangeCode, fetchDiscordUser } from '../../src/auth/discord'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('buildAuthorizeUrl', () => {
  it('includes all required query params', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'http://localhost:3000/auth/discord/callback',
      state: 'abc123',
    })
    const u = new URL(url)
    expect(u.origin).toBe('https://discord.com')
    expect(u.pathname).toBe('/api/oauth2/authorize')
    expect(u.searchParams.get('client_id')).toBe('cid')
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/discord/callback')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('scope')).toBe('identify')
    expect(u.searchParams.get('state')).toBe('abc123')
  })
})

describe('exchangeCode', () => {
  it('POSTs form-encoded credentials and returns the access_token', async () => {
    let capturedBody: string | null = null
    globalThis.fetch = mock(async (_url, init) => {
      capturedBody = init?.body as string
      return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await exchangeCode({
      clientId: 'cid',
      clientSecret: 'csecret',
      redirectUri: 'http://localhost:3000/auth/discord/callback',
      code: 'the-code',
    })

    expect(result).toEqual({ accessToken: 'tok' })
    const body = capturedBody as string | null
    if (body === null) throw new Error('Expected Discord token request body')
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=the-code')
    expect(body).toContain('client_id=cid')
    expect(body).toContain('client_secret=csecret')
  })

  it('throws on malformed successful responses', async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ access_token: 42 }), { status: 200 }),
    ) as unknown as typeof fetch
    await expect(exchangeCode({ clientId: 'c', clientSecret: 's', redirectUri: 'r', code: 'x' })).rejects.toThrow()
  })

  it('throws on non-200 responses', async () => {
    globalThis.fetch = mock(async () => new Response('nope', { status: 400 })) as unknown as typeof fetch
    await expect(exchangeCode({ clientId: 'c', clientSecret: 's', redirectUri: 'r', code: 'x' })).rejects.toThrow()
  })
})

describe('fetchDiscordUser', () => {
  it('returns the mapped profile', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            id: '42',
            username: 'coolguy',
            avatar: 'abc',
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch

    const result = await fetchDiscordUser('tok')
    expect(result).toEqual({ discordId: '42', username: 'coolguy', avatarHash: 'abc' })
  })

  it('tolerates a null avatar', async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ id: '42', username: 'x', avatar: null }), { status: 200 }),
    ) as unknown as typeof fetch
    const result = await fetchDiscordUser('tok')
    expect(result.avatarHash).toBeNull()
  })

  it('throws on malformed successful responses', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ id: 'not-a-snowflake', username: '', avatar: '../abc' }), { status: 200 }),
    ) as unknown as typeof fetch
    await expect(fetchDiscordUser('tok')).rejects.toThrow()
  })

  it('throws on non-200 responses', async () => {
    globalThis.fetch = mock(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    await expect(fetchDiscordUser('tok')).rejects.toThrow()
  })
})
