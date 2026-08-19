'use client'

import type { PinnedPlayersContract } from '@brawltome/contracts'
import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { parsePinnedPlayersResponse, pinnedPlayersKey, updatePinnedPlayersCache } from './pinnedPlayersCache'
import { invalidatePlayerShortcuts } from './playerShortcuts'
import { trpc } from './trpc'

export { parsePinnedPlayersResponse } from './pinnedPlayersCache'

export function usePinnedPlayers(accountId: string | null | undefined) {
  const query = useQuery({
    queryKey: pinnedPlayersKey(accountId ?? null),
    queryFn: async () => parsePinnedPlayersResponse(await trpc.account.pinnedPlayers.query()),
    enabled: Boolean(accountId),
  })
  return {
    pinnedPlayers: query.data ?? [],
    isLoading: Boolean(accountId) && query.isLoading,
    isError: Boolean(accountId) && query.isError,
    isReady: Boolean(accountId) && query.isSuccess,
  }
}

export function movePinnedPlayer(
  pinnedPlayers: PinnedPlayersContract,
  fromIndex: number,
  toIndex: number,
  primaryPlayerId: number | null = null,
): number[] {
  const ids = pinnedPlayers.map(({ brawlhallaId }) => brawlhallaId)
  if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length || fromIndex === toIndex) {
    return ids
  }

  const primaryIndex = primaryPlayerId === null ? -1 : ids.indexOf(primaryPlayerId)
  if (primaryIndex === -1) {
    const [moved] = ids.splice(fromIndex, 1)
    ids.splice(toIndex, 0, moved)
    return ids
  }

  const primaryId = ids[primaryIndex]
  if (primaryId === undefined || ids[fromIndex] === primaryId) return ids
  const managedIds = ids.filter((id) => id !== primaryId)
  const managedFromIndex = managedIds.indexOf(ids[fromIndex])
  const targetId = ids[toIndex]
  const managedToIndex =
    targetId === primaryId ? managedFromIndex + Math.sign(toIndex - fromIndex) : managedIds.indexOf(targetId)
  if (managedFromIndex === -1 || managedToIndex < 0 || managedToIndex >= managedIds.length) return ids

  const [moved] = managedIds.splice(managedFromIndex, 1)
  managedIds.splice(managedToIndex, 0, moved)
  managedIds.splice(primaryIndex, 0, primaryId)
  return managedIds
}

export function pinPlayer(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaId: number,
): Promise<PinnedPlayersContract> {
  return updatePinnedPlayers(queryClient, accountId, () => trpc.account.pinPlayer.mutate({ brawlhallaId }))
}

export function unpinPlayer(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaId: number,
): Promise<PinnedPlayersContract> {
  return updatePinnedPlayers(queryClient, accountId, () => trpc.account.unpinPlayer.mutate({ brawlhallaId }))
}

export function reorderPinnedPlayers(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  brawlhallaIds: number[],
): Promise<PinnedPlayersContract> {
  return updatePinnedPlayers(queryClient, accountId, () => trpc.account.reorderPinnedPlayers.mutate({ brawlhallaIds }))
}

async function updatePinnedPlayers(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  mutation: () => Promise<unknown>,
): Promise<PinnedPlayersContract> {
  const pinnedPlayers = await updatePinnedPlayersCache(queryClient, accountId, mutation)
  await invalidatePlayerShortcuts(queryClient, accountId)
  return pinnedPlayers
}
