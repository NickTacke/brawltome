process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/unused'

import { describe, expect, it, mock } from 'bun:test'
import type { Account } from '@brawltome/accounts'
import type { PlayerLinkRepo } from '@brawltome/identity'
import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { identityRouter } from '../../src/router/identity.router'

interface TestContext {
  account: Account | null
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

function makeAccount(): Account {
  return {
    id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
    displayName: 'coolguy',
    avatarUrl: 'https://cdn.discordapp.com/avatars/discord-42/abc.png',
    createdAt: new Date('2026-08-09T18:42:01.000Z'),
  }
}

describe('identity.me V2 compatibility', () => {
  it('returns null for anonymous callers', async () => {
    const result = await (
      caller({ account: null, playerLinkRepo: mockPlayerLinkRepo() }) as { me: () => Promise<unknown> }
    ).me()
    expect(result).toBeNull()
  })

  it('preserves the legacy shape from the safe Accounts principal', async () => {
    const account = makeAccount()
    const result = (await (
      caller({ account, playerLinkRepo: mockPlayerLinkRepo() }) as { me: () => Promise<unknown> }
    ).me()) as { id: string; username: string; avatarUrl: string | null; playerLink: unknown } | null

    expect(result).toMatchObject({
      id: account.id,
      username: 'coolguy',
      avatarUrl: 'https://cdn.discordapp.com/avatars/discord-42/abc.png',
      playerLink: null,
    })
  })
})
