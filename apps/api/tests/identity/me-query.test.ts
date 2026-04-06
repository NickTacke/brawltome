import { describe, expect, it } from 'bun:test'
import type { UserWithPrimaryAccount } from '@brawltome/identity'
import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { identityRouter } from '../../src/router/identity.router'

const t = initTRPC.context<{ user: UserWithPrimaryAccount | null }>().create({ transformer: superjson })
const caller = t.createCallerFactory(identityRouter as unknown as ReturnType<typeof t.router>)

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
    const result = await (caller({ user: null }) as { me: () => Promise<unknown> }).me()
    expect(result).toBeNull()
  })

  it('returns the serialized user for signed-in callers', async () => {
    const user = makeUser()
    const result = (await (caller({ user }) as { me: () => Promise<unknown> }).me()) as {
      id: string
      username: string
      avatarUrl: string | null
    } | null
    expect(result).not.toBeNull()
    expect(result?.id).toBe('user-1')
    expect(result?.username).toBe('coolguy')
    expect(result?.avatarUrl).toBe('https://cdn.discordapp.com/avatars/discord-42/abc.png')
  })

  it('returns a null avatarUrl when the account has no avatarHash', async () => {
    const user = makeUser()
    user.primaryAccount.avatarHash = null
    const result = (await (caller({ user }) as { me: () => Promise<unknown> }).me()) as {
      avatarUrl: string | null
    } | null
    expect(result?.avatarUrl).toBeNull()
  })
})
