'use client'

import { type SavedPlayersContract, parseSavedPlayersOutput } from '@brawltome/contracts'
import type { useQueryClient } from '@tanstack/react-query'

const SAVED_PLAYERS_KEY = ['account', 'savedPlayers'] as const

export function savedPlayersKey(accountId: string | null) {
  return [...SAVED_PLAYERS_KEY, accountId] as const
}

export function parseSavedPlayersResponse(value: unknown): SavedPlayersContract {
  return parseSavedPlayersOutput(value)
}

export function createLatestSavedPlayerMutationGuard() {
  const latestByAccount = new Map<string, symbol>()
  return {
    begin(accountId: string) {
      const token = Symbol(accountId)
      latestByAccount.set(accountId, token)
      return () => latestByAccount.get(accountId) === token
    },
  }
}

const mutationGuards = new WeakMap<object, ReturnType<typeof createLatestSavedPlayerMutationGuard>>()

function mutationGuard(queryClient: object) {
  const existing = mutationGuards.get(queryClient)
  if (existing) return existing
  const created = createLatestSavedPlayerMutationGuard()
  mutationGuards.set(queryClient, created)
  return created
}

export async function updateSavedPlayersCache(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  mutation: () => Promise<unknown>,
): Promise<SavedPlayersContract> {
  const isLatest = mutationGuard(queryClient).begin(accountId)
  await queryClient.cancelQueries({ queryKey: savedPlayersKey(accountId) })
  try {
    const savedPlayers = parseSavedPlayersResponse(await mutation())
    if (isLatest()) {
      await queryClient.cancelQueries({ queryKey: savedPlayersKey(accountId) })
      if (isLatest()) queryClient.setQueryData(savedPlayersKey(accountId), savedPlayers)
    }
    return savedPlayers
  } catch (error) {
    if (isLatest()) await queryClient.invalidateQueries({ queryKey: savedPlayersKey(accountId) })
    throw error
  }
}
