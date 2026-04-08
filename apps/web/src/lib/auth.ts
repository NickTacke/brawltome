'use client'

import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { trpc } from './trpc'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export interface PlayerLinkInfo {
  brawlhallaId: number | null
  steamId: string
  status: 'pending' | 'linked' | 'failed' | 'conflict'
  linkedAt: Date
}

export interface Me {
  id: string
  username: string
  avatarUrl: string | null
  createdAt: string
  playerLink: PlayerLinkInfo | null
}

const ME_KEY = ['identity', 'me'] as const

export function useMe() {
  const query = useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Me | null> => {
      return (await trpc.identity.me.query()) as Me | null
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const data = query.state.data as Me | null | undefined
      if (data?.playerLink?.status === 'pending') return 2_000
      return false
    },
  })
  return { user: query.data ?? null, isLoading: query.isLoading }
}

export function signIn(): void {
  window.location.href = `${apiUrl}/auth/discord/login`
}

export function linkSteam(): void {
  window.location.href = `${apiUrl}/auth/steam/link`
}

export async function signOut(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await fetch(`${apiUrl}/auth/signout`, { method: 'POST', credentials: 'include' })
  await queryClient.invalidateQueries({ queryKey: ME_KEY })
}

export async function unlinkPlayer(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await trpc.identity.unlinkPlayer.mutate()
  await queryClient.invalidateQueries({ queryKey: ME_KEY })
}
