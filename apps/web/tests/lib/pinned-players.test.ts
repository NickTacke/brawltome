import { describe, expect, test } from 'bun:test'
import type { PinnedPlayersContract } from '@brawltome/contracts'
import { QueryClient } from '@tanstack/react-query'
import { movePinnedPlayer, parsePinnedPlayersResponse } from '../../src/lib/pinnedPlayers'
import {
  createLatestPinnedPlayerMutationGuard,
  pinnedPlayersKey,
  updatePinnedPlayersCache,
} from '../../src/lib/pinnedPlayersCache'

const pinnedPlayers: PinnedPlayersContract = [
  {
    brawlhallaId: 42,
    order: 0,
    pinnedAt: '2026-08-10T09:00:00Z',
    player: { brawlhallaId: 42, name: 'Ada', aliases: [] },
    currentSeason: null,
  },
  {
    brawlhallaId: 43,
    order: 1,
    pinnedAt: '2026-08-10T09:01:00Z',
    player: { brawlhallaId: 43, name: 'Lin', aliases: [] },
    currentSeason: null,
  },
]

describe('Pinned Players client state', () => {
  test('parses canonical account output and rejects public or ownership fields', () => {
    expect(parsePinnedPlayersResponse(pinnedPlayers)).toEqual(pinnedPlayers)
    expect(() => parsePinnedPlayersResponse([{ ...pinnedPlayers[0], savedAt: pinnedPlayers[0].pinnedAt }])).toThrow()
    expect(() => parsePinnedPlayersResponse([{ ...pinnedPlayers[0], accountId: 'private' }])).toThrow()
    expect(() => parsePinnedPlayersResponse([{ ...pinnedPlayers[0], following: true }])).toThrow()
  })

  test('uses the account Pinned Players query key', () => {
    expect(pinnedPlayersKey('account-one')).toEqual(['account', 'pinnedPlayers', 'account-one'])
  })

  test('allows only the latest overlapping mutation to update an account cache', () => {
    const guard = createLatestPinnedPlayerMutationGuard()
    const first = guard.begin('account-one')
    const second = guard.begin('account-one')
    const otherAccount = guard.begin('account-two')

    expect(first()).toBe(false)
    expect(second()).toBe(true)
    expect(otherAccount()).toBe(true)
  })

  test('cancels an older query before a mutation updates the cache', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let resolveStaleQuery: ((value: PinnedPlayersContract) => void) | undefined
    const staleQuery = queryClient.fetchQuery({
      queryKey: ['account', 'pinnedPlayers', 'account-one'],
      queryFn: () =>
        new Promise<PinnedPlayersContract>((resolve) => {
          resolveStaleQuery = resolve
        }),
    })
    await Promise.resolve()

    await updatePinnedPlayersCache(queryClient, 'account-one', async () => pinnedPlayers)
    resolveStaleQuery?.([{ ...pinnedPlayers[0], player: { brawlhallaId: 42, name: 'Stale Ada', aliases: [] } }])
    await staleQuery.catch(() => undefined)

    const cachedResult: unknown = queryClient.getQueryData(['account', 'pinnedPlayers', 'account-one'])
    expect(cachedResult).toEqual(pinnedPlayers)
  })

  test('cancels a query started while a mutation is in flight before writing the result', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let markMutationStarted: (() => void) | undefined
    const mutationStarted = new Promise<void>((resolve) => {
      markMutationStarted = resolve
    })
    let resolveMutation: ((value: PinnedPlayersContract) => void) | undefined
    const mutationResult = new Promise<PinnedPlayersContract>((resolve) => {
      resolveMutation = resolve
    })
    const update = updatePinnedPlayersCache(queryClient, 'account-one', async () => {
      markMutationStarted?.()
      return mutationResult
    })
    await mutationStarted

    let resolveStaleQuery: ((value: PinnedPlayersContract) => void) | undefined
    const staleQuery = queryClient.fetchQuery({
      queryKey: ['account', 'pinnedPlayers', 'account-one'],
      queryFn: () =>
        new Promise<PinnedPlayersContract>((resolve) => {
          resolveStaleQuery = resolve
        }),
    })
    await Promise.resolve()
    resolveMutation?.(pinnedPlayers)
    await update
    resolveStaleQuery?.([{ ...pinnedPlayers[0], player: { brawlhallaId: 42, name: 'Stale Ada', aliases: [] } }])
    await staleQuery.catch(() => undefined)

    const cachedResult: unknown = queryClient.getQueryData(['account', 'pinnedPlayers', 'account-one'])
    expect(cachedResult).toEqual(pinnedPlayers)
  })

  test('builds stable independent Pinned Player reorders without mutating cached data', () => {
    expect(movePinnedPlayer(pinnedPlayers, 0, 1)).toEqual([43, 42])
    expect(movePinnedPlayer(pinnedPlayers, 1, 0)).toEqual([43, 42])
    expect(movePinnedPlayer(pinnedPlayers, 0, -1)).toEqual([42, 43])
    expect(pinnedPlayers.map(({ brawlhallaId }) => brawlhallaId)).toEqual([42, 43])
  })

  test('does not move a managed pin across a retained Primary Player', () => {
    const interleaved = [pinnedPlayers[1], pinnedPlayers[0], { ...pinnedPlayers[1], brawlhallaId: 44 }]
    expect(movePinnedPlayer(interleaved, 0, 1, 42)).toEqual([43, 42, 44])
    expect(movePinnedPlayer(interleaved, 2, 1, 42)).toEqual([43, 42, 44])
  })
})
