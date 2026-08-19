'use client'

import { type PinnedPlayersContract, pinnedPlayersSchema } from '@brawltome/contracts'
import type { useQueryClient } from '@tanstack/react-query'

const PINNED_PLAYERS_KEY = ['account', 'pinnedPlayers'] as const

export function pinnedPlayersKey(accountId: string | null) {
  return [...PINNED_PLAYERS_KEY, accountId] as const
}

export function parsePinnedPlayersResponse(value: unknown): PinnedPlayersContract {
  return pinnedPlayersSchema.parse(value)
}

export function createLatestPinnedPlayerMutationGuard() {
  const latestByAccount = new Map<string, symbol>()
  return {
    begin(accountId: string) {
      const token = Symbol(accountId)
      latestByAccount.set(accountId, token)
      return () => latestByAccount.get(accountId) === token
    },
  }
}

const mutationGuards = new WeakMap<object, ReturnType<typeof createLatestPinnedPlayerMutationGuard>>()

function mutationGuard(queryClient: object) {
  const existing = mutationGuards.get(queryClient)
  if (existing) return existing
  const created = createLatestPinnedPlayerMutationGuard()
  mutationGuards.set(queryClient, created)
  return created
}

export async function updatePinnedPlayersCache(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  mutation: () => Promise<unknown>,
): Promise<PinnedPlayersContract> {
  const isLatest = mutationGuard(queryClient).begin(accountId)
  await queryClient.cancelQueries({ queryKey: pinnedPlayersKey(accountId) })
  try {
    const pinnedPlayers = parsePinnedPlayersResponse(await mutation())
    if (isLatest()) {
      await queryClient.cancelQueries({ queryKey: pinnedPlayersKey(accountId) })
      if (isLatest()) queryClient.setQueryData(pinnedPlayersKey(accountId), pinnedPlayers)
    }
    return pinnedPlayers
  } catch (error) {
    if (isLatest()) await queryClient.invalidateQueries({ queryKey: pinnedPlayersKey(accountId) })
    throw error
  }
}
