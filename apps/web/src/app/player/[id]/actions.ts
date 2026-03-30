'use server'

import { getServerTrpc } from '@/lib/trpc-server'

export async function getPlayerAction(id: number) {
  const trpc = await getServerTrpc()
  return await trpc.player.byId.query({ id })
}

export async function refreshPlayerAction(id: number, turnstileToken: string) {
  const trpc = await getServerTrpc()
  return await trpc.player.refresh.mutate({ id, turnstileToken })
}
