'use client'

import type { SavedPlayersContract } from '@brawltome/contracts'
import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { invalidatePlayerShortcuts } from './playerShortcuts'
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
  return updatePins(queryClient, accountId, () => trpc.account.savePlayer.mutate({ brawlhallaId }))
}

export async function removeSavedPlayer(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaId: number,
): Promise<SavedPlayersContract> {
  const savedPlayers = await updateSavedPlayersCache(queryClient, accountId, () =>
    trpc.account.removeSavedPlayer.mutate({ brawlhallaId }),
  )
  await invalidatePlayerShortcuts(queryClient, accountId)
  return savedPlayers
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

export function orderedPinnedPlayers(savedPlayers: SavedPlayersContract) {
  return savedPlayers
    .filter((player) => player.pinOrder !== null)
    .sort((left, right) => (left.pinOrder ?? 0) - (right.pinOrder ?? 0))
}

export function movePinnedPlayer(savedPlayers: SavedPlayersContract, fromIndex: number, toIndex: number): number[] {
  const ids = orderedPinnedPlayers(savedPlayers).map(({ brawlhallaId }) => brawlhallaId)
  if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length || fromIndex === toIndex) {
    return ids
  }
  const [moved] = ids.splice(fromIndex, 1)
  ids.splice(toIndex, 0, moved)
  return ids
}

async function updatePins(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  mutation: () => Promise<unknown>,
): Promise<SavedPlayersContract> {
  const savedPlayers = await updateSavedPlayersCache(queryClient, accountId, mutation)
  await invalidatePlayerShortcuts(queryClient, accountId)
  return savedPlayers
}

export function pinSavedPlayer(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaId: number,
): Promise<SavedPlayersContract> {
  return updatePins(queryClient, accountId, () => trpc.account.pinSavedPlayer.mutate({ brawlhallaId }))
}

export function unpinSavedPlayer(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaId: number,
): Promise<SavedPlayersContract> {
  return updatePins(queryClient, accountId, () => trpc.account.unpinSavedPlayer.mutate({ brawlhallaId }))
}

export function reorderPinnedPlayers(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaIds: number[],
): Promise<SavedPlayersContract> {
  return updatePins(queryClient, accountId, () => trpc.account.reorderPinnedPlayers.mutate({ brawlhallaIds }))
}
