import { describe, expect, test } from 'bun:test'
import type { PlayerReferenceQueries } from '@brawltome/player'
import { createPlayerReferenceRouter } from '../src/router/player-reference.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'player-reference-test-secret'

function callerFor(playerReferenceQueries: PlayerReferenceQueries) {
  const context = { internalSecret: secret, playerReferenceQueries } as Context
  return createPlayerReferenceRouter(createInternalProcedure(secret)).createCaller(context)
}

describe('player.referenceById', () => {
  test('validates input, delegates once, and returns canonical output', async () => {
    const calls: number[] = []
    const caller = callerFor({
      async byId(id) {
        calls.push(id)
        return { brawlhallaId: id, name: 'Ada', aliases: ['Former Ada'] }
      },
    })

    await expect(caller.referenceById({ id: 42 })).resolves.toEqual({
      brawlhallaId: 42,
      name: 'Ada',
      aliases: ['Former Ada'],
    })
    expect(calls).toEqual([42])

    await expect(caller.referenceById({ id: 0 })).rejects.toThrow()
    await expect(caller.referenceById({ id: 2_147_483_648 })).rejects.toThrow()
    expect(calls).toEqual([42])
  })

  test('preserves absence and rejects malformed producer output', async () => {
    await expect(callerFor({ byId: async () => null }).referenceById({ id: 42 })).resolves.toBeNull()
    await expect(
      callerFor({ byId: async (id) => ({ brawlhallaId: id, name: '', aliases: [] }) }).referenceById({ id: 42 }),
    ).rejects.toThrow()
  })
})
