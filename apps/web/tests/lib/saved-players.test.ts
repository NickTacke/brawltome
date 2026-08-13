import { describe, expect, test } from 'bun:test'
import type { SavedPlayersContract } from '@brawltome/contracts'
import { QueryClient } from '@tanstack/react-query'
import { movePinnedPlayer, moveSavedPlayer, parseSavedPlayersResponse } from '../../src/lib/savedPlayers'
import { createLatestSavedPlayerMutationGuard, updateSavedPlayersCache } from '../../src/lib/savedPlayersCache'

const savedPlayers: SavedPlayersContract = [
  {
    brawlhallaId: 42,
    order: 0,
    pinOrder: 0,
    savedAt: '2026-08-10T09:00:00Z',
    player: { brawlhallaId: 42, name: 'Ada' },
    currentSeason: null,
  },
  {
    brawlhallaId: 43,
    order: 1,
    pinOrder: null,
    savedAt: '2026-08-10T09:01:00Z',
    player: { brawlhallaId: 43, name: 'Lin' },
    currentSeason: null,
  },
]

describe('Saved Players client state', () => {
  test('parses canonical account output and rejects public or ownership fields', () => {
    expect(parseSavedPlayersResponse(savedPlayers)).toEqual(savedPlayers)
    expect(() => parseSavedPlayersResponse([{ ...savedPlayers[0], accountId: 'private' }])).toThrow()
    expect(() => parseSavedPlayersResponse([{ ...savedPlayers[0], following: true }])).toThrow()
  })

  test('allows only the latest overlapping mutation to update an account cache', () => {
    const guard = createLatestSavedPlayerMutationGuard()
    const first = guard.begin('account-one')
    const second = guard.begin('account-one')
    const otherAccount = guard.begin('account-two')

    expect(first()).toBe(false)
    expect(second()).toBe(true)
    expect(otherAccount()).toBe(true)
  })

  test('cancels an older query before a mutation updates the cache', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let resolveStaleQuery: ((value: SavedPlayersContract) => void) | undefined
    const staleQuery = queryClient.fetchQuery({
      queryKey: ['account', 'savedPlayers', 'account-one'],
      queryFn: () =>
        new Promise<SavedPlayersContract>((resolve) => {
          resolveStaleQuery = resolve
        }),
    })
    await Promise.resolve()

    await updateSavedPlayersCache(queryClient, 'account-one', async () => savedPlayers)
    resolveStaleQuery?.([{ ...savedPlayers[0], player: { brawlhallaId: 42, name: 'Stale Ada' } }])
    await staleQuery.catch(() => undefined)

    const cachedResult: unknown = queryClient.getQueryData(['account', 'savedPlayers', 'account-one'])
    expect(cachedResult).toEqual(savedPlayers)
  })

  test('cancels a query started while a mutation is in flight before writing the result', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let markMutationStarted: (() => void) | undefined
    const mutationStarted = new Promise<void>((resolve) => {
      markMutationStarted = resolve
    })
    let resolveMutation: ((value: SavedPlayersContract) => void) | undefined
    const mutationResult = new Promise<SavedPlayersContract>((resolve) => {
      resolveMutation = resolve
    })
    const update = updateSavedPlayersCache(queryClient, 'account-one', async () => {
      markMutationStarted?.()
      return mutationResult
    })
    await mutationStarted

    let resolveStaleQuery: ((value: SavedPlayersContract) => void) | undefined
    const staleQuery = queryClient.fetchQuery({
      queryKey: ['account', 'savedPlayers', 'account-one'],
      queryFn: () =>
        new Promise<SavedPlayersContract>((resolve) => {
          resolveStaleQuery = resolve
        }),
    })
    await Promise.resolve()
    resolveMutation?.(savedPlayers)
    await update
    resolveStaleQuery?.([{ ...savedPlayers[0], player: { brawlhallaId: 42, name: 'Stale Ada' } }])
    await staleQuery.catch(() => undefined)

    const cachedResult: unknown = queryClient.getQueryData(['account', 'savedPlayers', 'account-one'])
    expect(cachedResult).toEqual(savedPlayers)
  })

  test('builds stable independent Saved Player and pin reorders without mutating cached data', () => {
    expect(moveSavedPlayer(savedPlayers, 0, 1)).toEqual([43, 42])
    expect(movePinnedPlayer(savedPlayers, 0, 0)).toEqual([42])
    expect(moveSavedPlayer(savedPlayers, 1, 0)).toEqual([43, 42])
    expect(moveSavedPlayer(savedPlayers, 0, -1)).toEqual([42, 43])
    expect(savedPlayers.map(({ brawlhallaId }) => brawlhallaId)).toEqual([42, 43])
  })
})
