'use client'

import {
  type AccountPreferencesContract,
  type AccountPreferencesUpdateContract,
  type AccountViewContract,
  type PrimaryPlayerVerificationStateContract,
  accountPreferencesSchema,
  parseAccountViewOutput,
  parsePrimaryPlayerVerificationStateOutput,
} from '@brawltome/contracts'
import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { publicApiUrl } from './api-url'
import { trpc } from './trpc'

const ACCOUNT_KEY = ['account', 'current'] as const
const ACCOUNT_PREFERENCES_KEY = ['account', 'preferences'] as const
const accountPreferencesKey = (accountId: string | null) =>
  [...ACCOUNT_PREFERENCES_KEY, accountId ?? 'anonymous'] as const
const PRIMARY_PLAYER_KEY = ['account', 'primaryPlayer'] as const

export function parseAccountResponse(value: unknown): AccountViewContract {
  return parseAccountViewOutput(value)
}

export function parseAccountPreferencesResponse(value: unknown): AccountPreferencesContract {
  return accountPreferencesSchema.parse(value)
}

export function useAccount() {
  const query = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: async () => parseAccountResponse(await trpc.account.current.query()),
    staleTime: 5 * 60 * 1000,
  })
  const view = query.data
  return {
    account: view?.status === 'signedIn' ? view.account : null,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

export function useAccountPreferences(accountId: string | null | undefined) {
  const query = useQuery({
    queryKey: accountPreferencesKey(accountId ?? null),
    queryFn: async () => parseAccountPreferencesResponse(await trpc.account.preferences.query()),
    enabled: accountId !== undefined && accountId !== null,
    staleTime: 5 * 60 * 1000,
  })
  return { preferences: query.data ?? null, isLoading: query.isLoading, isError: query.isError }
}

export function parsePrimaryPlayerResponse(value: unknown): PrimaryPlayerVerificationStateContract {
  return parsePrimaryPlayerVerificationStateOutput(value)
}

export function usePrimaryPlayer() {
  const query = useQuery({
    queryKey: PRIMARY_PLAYER_KEY,
    queryFn: async () => parsePrimaryPlayerResponse(await trpc.account.primaryPlayer.query()),
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => (query.state.data?.attempts[0]?.status === 'pending' ? 2_000 : false),
  })
  return { state: query.data ?? null, isLoading: query.isLoading, isError: query.isError }
}

function authUrl(path: '/auth/discord/login' | '/auth/steam/link'): string {
  const url = new URL(path, publicApiUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid authentication origin')
  }
  return url.toString()
}

export function signIn(): void {
  window.location.assign(authUrl('/auth/discord/login'))
}

export function linkSteam(): void {
  window.location.assign(authUrl('/auth/steam/link'))
}

export async function saveAccountPreferences(
  queryClient: ReturnType<typeof useQueryClient>,
  accountId: string,
  update: AccountPreferencesUpdateContract,
): Promise<AccountPreferencesContract> {
  const updated = parseAccountPreferencesResponse(await trpc.account.updatePreferences.mutate(update))
  queryClient.setQueryData(accountPreferencesKey(accountId), updated)
  return updated
}

export async function signOut(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  const response = await fetch(`${publicApiUrl}/auth/signout`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error(`Sign-out failed with status ${response.status}`)

  queryClient.removeQueries({ queryKey: ACCOUNT_PREFERENCES_KEY })
  queryClient.removeQueries({ queryKey: ['account', 'pinnedPlayers'] })
  queryClient.removeQueries({ queryKey: ['account', 'playerShortcuts'] })
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY }),
    queryClient.invalidateQueries({ queryKey: PRIMARY_PLAYER_KEY }),
  ])
}
