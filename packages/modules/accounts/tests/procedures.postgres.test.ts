import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { call, ORPCError } from '@orpc/server'
import { createAccountProcedures } from '../api/procedures'
import { createPostgresAccounts } from '../index'
import { accountsTestModules } from '../testing'

const dayMs = 24 * 60 * 60 * 1000
const outsideCaller = { context: { isInternalCaller: false, visitorSessionToken: 'any' } }

let database: TestDatabase
let procedures: ReturnType<typeof createAccountProcedures>
let accounts: ReturnType<typeof createPostgresAccounts>['accounts']
let discordIdCounter = 0

beforeAll(async () => {
  database = await createTestDatabase({ label: 'accounts_procedures', modules: accountsTestModules })
  procedures = createAccountProcedures({ database })
  accounts = createPostgresAccounts(database).accounts
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

function visitor(sessionToken?: string) {
  return { context: { isInternalCaller: true, visitorSessionToken: sessionToken } }
}

async function signIn(displayName = 'Ada') {
  discordIdCounter += 1

  const profile = { providerAccountId: `discord-${discordIdCounter}`, displayName, avatarHash: null }

  return accounts.signInWithDiscord(profile)
}

async function setSessionExpiry(sessionToken: string, expiresAt: Date) {
  const sessionId = createHash('sha256').update(sessionToken).digest('hex')

  await database.sql`UPDATE accounts.sessions SET expires_at = ${expiresAt} WHERE id = ${sessionId}`
}

async function failureCode(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    if (error instanceof ORPCError) return error.code

    throw error
  }

  throw new Error('expected the call to fail')
}

async function verify(accountId: string, steamId: string, evidence: { brawlhallaId: number; name: string } | null) {
  const attempt = await accounts.beginPrimaryPlayerVerification({ accountId, steamId, idempotencyKey: steamId })

  const resolved = evidence
    ? { ...evidence, checkedAt: new Date(), source: 'brawlhalla-v0-steam-search' as const }
    : null

  return accounts.resolvePrimaryPlayerVerification(attempt.id, { resolve: async () => resolved })
}

describe('the account the site reads for a visitor', () => {
  test('is anonymous without a session', async () => {
    expect(await call(procedures.current, undefined, visitor())).toEqual({ status: 'anonymous' })
  })

  test('is anonymous for a session the api does not know', async () => {
    expect(await call(procedures.current, undefined, visitor('made-up-token'))).toEqual({ status: 'anonymous' })
  })

  test('is anonymous for an expired session', async () => {
    const { sessionToken } = await signIn()

    await setSessionExpiry(sessionToken, new Date(Date.now() - 1000))

    expect(await call(procedures.current, undefined, visitor(sessionToken))).toEqual({ status: 'anonymous' })
  })

  test('is the signed in account for a valid session', async () => {
    const { account, sessionToken } = await signIn('Ada')

    expect(await call(procedures.current, undefined, visitor(sessionToken))).toEqual({
      status: 'signedIn',
      account: {
        id: account.id,
        displayName: 'Ada',
        avatarUrl: null,
        createdAt: account.createdAt.toISOString(),
      },
      sessionRenewedUntil: null,
    })
  })

  test('says until when it renewed a session close to its end', async () => {
    const { sessionToken } = await signIn()

    await setSessionExpiry(sessionToken, new Date(Date.now() + dayMs))

    const answer = await call(procedures.current, undefined, visitor(sessionToken))
    const renewedUntil = answer.status === 'signedIn' ? Date.parse(answer.sessionRenewedUntil ?? '') : 0

    expect(renewedUntil).toBeGreaterThan(Date.now() + 29 * dayMs)
  })

  test('is refused to anyone without the internal secret', async () => {
    expect(await failureCode(call(procedures.current, undefined, outsideCaller))).toBe('FORBIDDEN')
  })
})

describe('pinned players', () => {
  test('are listed in their order for the visitor', async () => {
    const { account, sessionToken } = await signIn()

    await accounts.pinPlayer(account.id, 11)
    await accounts.pinPlayer(account.id, 12)

    const pins = await call(procedures.pinnedPlayers, undefined, visitor(sessionToken))

    expect(pins.map(({ brawlhallaId, order }) => [brawlhallaId, order])).toEqual([
      [11, 0],
      [12, 1],
    ])
  })

  test('need a session the api accepts', async () => {
    expect(await failureCode(call(procedures.pinnedPlayers, undefined, visitor()))).toBe('UNAUTHORIZED')
    expect(await failureCode(call(procedures.pinnedPlayers, undefined, visitor('made-up')))).toBe('UNAUTHORIZED')
  })

  test('lose the one unpinned, and only for the visitor', async () => {
    const visitorSignIn = await signIn()
    const otherSignIn = await signIn()

    for (const brawlhallaId of [21, 22, 23]) await accounts.pinPlayer(visitorSignIn.account.id, brawlhallaId)

    await accounts.pinPlayer(otherSignIn.account.id, 22)

    const input = { brawlhallaId: 22 }
    const pins = await call(procedures.unpinPlayer, input, visitor(visitorSignIn.sessionToken))
    const otherPins = await accounts.getPinnedPlayers(otherSignIn.account.id)

    expect(pins.map(({ brawlhallaId, order }) => [brawlhallaId, order])).toEqual([
      [21, 0],
      [23, 1],
    ])

    expect(otherPins.map(({ brawlhallaId }) => brawlhallaId)).toEqual([22])
  })

  test('take a new order', async () => {
    const { account, sessionToken } = await signIn()

    for (const brawlhallaId of [31, 32, 33]) await accounts.pinPlayer(account.id, brawlhallaId)

    const pins = await call(procedures.reorderPinnedPlayers, { brawlhallaIds: [33, 31, 32] }, visitor(sessionToken))

    expect(pins.map(({ brawlhallaId }) => brawlhallaId)).toEqual([33, 31, 32])
  })

  test('refuse an order that leaves a pin out', async () => {
    const { account, sessionToken } = await signIn()

    for (const brawlhallaId of [41, 42]) await accounts.pinPlayer(account.id, brawlhallaId)

    const reorder = call(procedures.reorderPinnedPlayers, { brawlhallaIds: [42] }, visitor(sessionToken))

    expect(await failureCode(reorder)).toBe('BAD_REQUEST')
  })

  test('refuse writes without a session the api accepts', async () => {
    const unpin = () => call(procedures.unpinPlayer, { brawlhallaId: 1 }, visitor('made-up'))
    const reorder = () => call(procedures.reorderPinnedPlayers, { brawlhallaIds: [] }, visitor())

    expect(await failureCode(unpin())).toBe('UNAUTHORIZED')
    expect(await failureCode(reorder())).toBe('UNAUTHORIZED')
  })
})

describe('the verified account', () => {
  test('is missing before any verification', async () => {
    const { sessionToken } = await signIn()

    const state = await call(procedures.primaryPlayer, undefined, visitor(sessionToken))

    expect(state).toEqual({ primaryPlayer: null, attempts: [] })
  })

  test('is pending while steam is checked', async () => {
    const { account, sessionToken } = await signIn()

    await accounts.beginPrimaryPlayerVerification({ accountId: account.id, steamId: 'steam-p', idempotencyKey: 'p' })

    const state = await call(procedures.primaryPlayer, undefined, visitor(sessionToken))

    expect(state.primaryPlayer).toBeNull()
    expect(state.attempts.map(({ status }) => status)).toEqual(['pending'])
  })

  test('is the player steam proved', async () => {
    const { account, sessionToken } = await signIn()

    await verify(account.id, 'steam-v', { brawlhallaId: 501, name: 'Proved' })

    const state = await call(procedures.primaryPlayer, undefined, visitor(sessionToken))

    expect(state.primaryPlayer).toMatchObject({ brawlhallaId: 501, name: 'Proved' })
    expect(state.attempts.map(({ status }) => status)).toEqual(['verified'])
  })

  test('is missing when steam found no player', async () => {
    const { account, sessionToken } = await signIn()

    await verify(account.id, 'steam-f', null)

    const state = await call(procedures.primaryPlayer, undefined, visitor(sessionToken))

    expect(state.primaryPlayer).toBeNull()
    expect(state.attempts.map(({ status }) => status)).toEqual(['failed'])
  })

  test('is missing when another account already verified the player', async () => {
    const owner = await signIn()
    const { account, sessionToken } = await signIn()

    await verify(owner.account.id, 'steam-owner', { brawlhallaId: 601, name: 'Taken' })
    await verify(account.id, 'steam-late', { brawlhallaId: 601, name: 'Taken' })

    const state = await call(procedures.primaryPlayer, undefined, visitor(sessionToken))

    expect(state.primaryPlayer).toBeNull()
    expect(state.attempts.map(({ status }) => status)).toEqual(['conflict'])
  })

  test('needs a session the api accepts', async () => {
    expect(await failureCode(call(procedures.primaryPlayer, undefined, visitor('made-up')))).toBe('UNAUTHORIZED')
  })
})

describe('sign out', () => {
  test('ends the session', async () => {
    const { sessionToken } = await signIn()

    expect(await call(procedures.signOut, undefined, visitor(sessionToken))).toEqual({ status: 'signedOut' })
    expect(await call(procedures.current, undefined, visitor(sessionToken))).toEqual({ status: 'anonymous' })
  })

  test('leaves other sessions of the account alone', async () => {
    const first = await signIn()
    const discordId = `discord-${discordIdCounter}`

    const second = await accounts.signInWithDiscord({
      providerAccountId: discordId,
      displayName: 'Ada',
      avatarHash: null,
    })

    await call(procedures.signOut, undefined, visitor(first.sessionToken))

    const answer = await call(procedures.current, undefined, visitor(second.sessionToken))

    expect(answer.status).toBe('signedIn')
  })

  test('answers signed out without a session', async () => {
    expect(await call(procedures.signOut, undefined, visitor())).toEqual({ status: 'signedOut' })
  })

  test('is refused to anyone without the internal secret', async () => {
    expect(await failureCode(call(procedures.signOut, undefined, outsideCaller))).toBe('FORBIDDEN')
  })
})
