'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { trpc } from './trpc'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export interface Me {
  id: string
  username: string
  avatarUrl: string | null
  createdAt: string
}

const ME_KEY = ['identity', 'me'] as const

export function useMe() {
  const query = useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Me | null> => {
      return (await trpc.identity.me.query()) as Me | null
    },
    staleTime: 5 * 60 * 1000,
  })
  return { user: query.data ?? null, isLoading: query.isLoading }
}

export function signIn(): void {
  window.location.href = `${apiUrl}/auth/discord/login`
}

export async function signOut(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await fetch(`${apiUrl}/auth/signout`, { method: 'POST', credentials: 'include' })
  await queryClient.invalidateQueries({ queryKey: ME_KEY })
}
