'use server'

import { getServerActionTrpc, getServerTrpc } from '@/lib/trpc-server'

export async function getClanAction(id: number) {
  const trpc = await getServerTrpc()
  return trpc.clan.byId.query({ id })
}

export async function refreshClanAction(id: number, turnstileToken?: string) {
  const trpc = await getServerActionTrpc()
  return trpc.clan.refresh.mutate({ id, ...(turnstileToken ? { turnstileToken } : {}) })
}
