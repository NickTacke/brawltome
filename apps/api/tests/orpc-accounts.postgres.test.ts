import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { accountsModule, createPostgresAccounts } from '@brawltome/accounts'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'

const secret = 'orpc-accounts-test-secret'

let database: TestDatabase
let app: Hono
let accounts: ReturnType<typeof createPostgresAccounts>['accounts']

beforeAll(async () => {
  database = await createTestDatabase({ label: 'orpc_accounts', modules: [queueModule, accountsModule] })
  accounts = createPostgresAccounts(database).accounts

  const router = createOrpcRouter([queueModule, accountsModule], { database })
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })

  app = new Hono()
  app.route('/', createOrpcRoutes({ telemetry, router, internalSecret: secret }))
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

type SiteCall = { method?: string; sessionToken?: string; body?: unknown; headers?: Record<string, string> }

// what the site's api client sends: the secret, and the visitor's session token when there is one
async function callAsSite(path: string, { method = 'GET', sessionToken, body, headers = {} }: SiteCall = {}) {
  const siteHeaders: Record<string, string> = { 'x-internal-secret': secret, ...headers }

  if (sessionToken) siteHeaders['x-visitor-session'] = sessionToken

  if (body !== undefined) siteHeaders['content-type'] = 'application/json'

  const init = { method, headers: siteHeaders, body: body === undefined ? undefined : JSON.stringify(body) }
  const response = await app.fetch(new Request(`http://api.test/v1${path}`, init))

  return { status: response.status, body: await response.json() }
}

async function signIn(discordId: string) {
  return accounts.signInWithDiscord({ providerAccountId: discordId, displayName: 'Ada', avatarHash: null })
}

describe('the account procedures over http', () => {
  test('read the account of the session the site forwards', async () => {
    const { account, sessionToken } = await signIn('http-1')
    const answer = await callAsSite('/account', { sessionToken })

    expect(answer.status).toBe(200)
    expect(answer.body).toMatchObject({ status: 'signedIn', account: { id: account.id } })
  })

  test('answer anonymous without a forwarded session', async () => {
    expect(await callAsSite('/account')).toEqual({ status: 200, body: { status: 'anonymous' } })
  })

  test('ignore a session cookie, only the forwarded header counts', async () => {
    const { sessionToken } = await signIn('http-2')
    const answer = await callAsSite('/account', { headers: { cookie: `brawltome_session=${sessionToken}` } })

    expect(answer.body).toEqual({ status: 'anonymous' })
  })

  test('refuse a caller without the secret, even with a valid session', async () => {
    const { sessionToken } = await signIn('http-3')
    const headers = { 'x-internal-secret': 'wrong', 'x-visitor-session': sessionToken }
    const response = await app.fetch(new Request('http://api.test/v1/account', { headers }))

    expect(response.status).toBe(403)
  })

  test('answer 401 to a read that needs a session the api rejects', async () => {
    expect((await callAsSite('/account/pinned-players', { sessionToken: 'made-up' })).status).toBe(401)
  })

  test('pin by body', async () => {
    const { sessionToken } = await signIn('http-6')

    const pinned = await callAsSite('/account/pinned-players', {
      method: 'POST',
      sessionToken,
      body: { brawlhallaId: 7 },
    })

    expect(pinned.status).toBe(200)
    expect(pinned.body.map((pin: { brawlhallaId: number }) => pin.brawlhallaId)).toEqual([7])
  })

  test('unpin by path and reorder by body', async () => {
    const { account, sessionToken } = await signIn('http-4')

    for (const brawlhallaId of [7, 8, 9]) await accounts.pinPlayer(account.id, brawlhallaId)

    const unpinned = await callAsSite('/account/pinned-players/8', { method: 'DELETE', sessionToken })
    const body = { brawlhallaIds: [9, 7] }
    const reordered = await callAsSite('/account/pinned-players', { method: 'PUT', sessionToken, body })

    expect(unpinned.body.map((pin: { brawlhallaId: number }) => pin.brawlhallaId)).toEqual([7, 9])
    expect(reordered.body.map((pin: { brawlhallaId: number }) => pin.brawlhallaId)).toEqual([9, 7])
  })

  test('sign out ends the forwarded session', async () => {
    const { sessionToken } = await signIn('http-5')
    const signedOut = await callAsSite('/account/sign-out', { method: 'POST', sessionToken })

    expect(signedOut).toEqual({ status: 200, body: { status: 'signedOut' } })
    expect((await callAsSite('/account', { sessionToken })).body).toEqual({ status: 'anonymous' })
  })
})
