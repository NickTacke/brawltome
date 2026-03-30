'use server'

import { getServerTrpc } from '@/lib/trpc-server'

export async function getClanAction(id: number) {
  const trpc = await getServerTrpc()
  return await trpc.clan.byId.query({ id })
}

export async function refreshClanAction(id: number, turnstileToken: string) {
  const trpc = await getServerTrpc()
  return await trpc.clan.refresh.mutate({ id, turnstileToken })
}
