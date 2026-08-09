'use client'

import { type AccountViewContract, parseAccountViewOutput } from '@brawltome/contracts'
import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { trpc } from './trpc'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export interface PlayerLinkInfo {
  brawlhallaId: number | null
  steamId: string
  status: 'pending' | 'linked' | 'failed' | 'conflict'
  linkedAt: Date
}

const ACCOUNT_KEY = ['account', 'current'] as const
const PLAYER_LINK_KEY = ['identity', 'playerLink'] as const

export function parseAccountResponse(value: unknown): AccountViewContract {
  return parseAccountViewOutput(value)
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
  }
}

export function usePlayerLink() {
  const query = useQuery({
    queryKey: PLAYER_LINK_KEY,
    queryFn: async (): Promise<PlayerLinkInfo | null> => {
      const legacyIdentity = await trpc.identity.me.query()
      return legacyIdentity?.playerLink ?? null
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2_000 : false),
  })
  return { playerLink: query.data ?? null, isLoading: query.isLoading }
}

export function signIn(): void {
  window.location.href = `${apiUrl}/auth/discord/login`
}

export function linkSteam(): void {
  window.location.href = `${apiUrl}/auth/steam/link`
}

export async function signOut(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  const response = await fetch(`${apiUrl}/auth/signout`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error(`Sign-out failed with status ${response.status}`)

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY }),
    queryClient.invalidateQueries({ queryKey: PLAYER_LINK_KEY }),
  ])
}

export async function unlinkPlayer(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await trpc.identity.unlinkPlayer.mutate()
  await queryClient.invalidateQueries({ queryKey: PLAYER_LINK_KEY })
}
