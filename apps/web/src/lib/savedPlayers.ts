'use client'

import type { SavedPlayersContract } from '@brawltome/contracts'
import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { parseSavedPlayersResponse, savedPlayersKey, updateSavedPlayersCache } from './savedPlayersCache'
import { trpc } from './trpc'

export { parseSavedPlayersResponse } from './savedPlayersCache'

export function useSavedPlayers(accountId: string | null | undefined) {
  const query = useQuery({
    queryKey: savedPlayersKey(accountId ?? null),
    queryFn: async () => parseSavedPlayersResponse(await trpc.account.savedPlayers.query()),
    enabled: Boolean(accountId),
  })
  return {
    savedPlayers: query.data ?? [],
    isLoading: Boolean(accountId) && query.isLoading,
    isError: Boolean(accountId) && query.isError,
    isReady: Boolean(accountId) && query.isSuccess,
  }
}

export function moveSavedPlayer(savedPlayers: SavedPlayersContract, fromIndex: number, toIndex: number): number[] {
  const ids = savedPlayers.map(({ brawlhallaId }) => brawlhallaId)
  if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length || fromIndex === toIndex) {
    return ids
  }
  const [moved] = ids.splice(fromIndex, 1)
  ids.splice(toIndex, 0, moved)
  return ids
}

export function savePlayer(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaId: number,
): Promise<SavedPlayersContract> {
  return updateSavedPlayersCache(queryClient, accountId, () => trpc.account.savePlayer.mutate({ brawlhallaId }))
}

export function removeSavedPlayer(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaId: number,
): Promise<SavedPlayersContract> {
  return updateSavedPlayersCache(queryClient, accountId, () => trpc.account.removeSavedPlayer.mutate({ brawlhallaId }))
}

export function reorderSavedPlayers(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaIds: number[],
): Promise<SavedPlayersContract> {
  return updateSavedPlayersCache(queryClient, accountId, () =>
    trpc.account.reorderSavedPlayers.mutate({ brawlhallaIds }),
  )
}
