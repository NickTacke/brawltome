// identityRouter now transitively imports @brawltome/database via unlinkPlayer
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/unused'

import { describe, expect, it, mock } from 'bun:test'
import type { PlayerLinkRepo, UserWithPrimaryAccount } from '@brawltome/identity'
import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { identityRouter } from '../../src/router/identity.router'

interface TestContext {
  user: UserWithPrimaryAccount | null
  playerLinkRepo: PlayerLinkRepo
}

const t = initTRPC.context<TestContext>().create({ transformer: superjson })
const caller = t.createCallerFactory(identityRouter as unknown as ReturnType<typeof t.router>)

function mockPlayerLinkRepo(): PlayerLinkRepo {
  return {
    findByUserId: mock(async () => null),
    findByBrawlhallaId: mock(async () => null),
    createPending: mock(async () => ({
      userId: '',
      brawlhallaId: null,
      steamId: '',
      linkedVia: 'steam' as const,
      status: 'pending' as const,
      linkedAt: new Date(),
    })),
    resolve: mock(async () => {}),
    setStatus: mock(async () => {}),
    deleteByUserId: mock(async () => {}),
  }
}

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

describe('identity.me', () => {
  it('returns null for anonymous callers', async () => {
    const ctx = { user: null, playerLinkRepo: mockPlayerLinkRepo() }
    const result = await (caller(ctx) as { me: () => Promise<unknown> }).me()
    expect(result).toBeNull()
  })

  it('returns the serialized user for signed-in callers', async () => {
    const user = makeUser()
    const ctx = { user, playerLinkRepo: mockPlayerLinkRepo() }
    const result = (await (caller(ctx) as { me: () => Promise<unknown> }).me()) as {
      id: string
      username: string
      avatarUrl: string | null
      playerLink: unknown
    } | null
    expect(result).not.toBeNull()
    expect(result?.id).toBe('user-1')
    expect(result?.username).toBe('coolguy')
    expect(result?.avatarUrl).toBe('https://cdn.discordapp.com/avatars/discord-42/abc.png')
    expect(result?.playerLink).toBeNull()
  })

  it('returns a null avatarUrl when the account has no avatarHash', async () => {
    const user = makeUser()
    user.primaryAccount.avatarHash = null
    const ctx = { user, playerLinkRepo: mockPlayerLinkRepo() }
    const result = (await (caller(ctx) as { me: () => Promise<unknown> }).me()) as {
      avatarUrl: string | null
    } | null
    expect(result?.avatarUrl).toBeNull()
  })
})
