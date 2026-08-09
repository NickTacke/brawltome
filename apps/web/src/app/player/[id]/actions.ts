'use server'

import { loadPlayerWithReference } from '@/lib/player-reference'
import { getServerTrpc } from '@/lib/trpc-server'

export async function getPlayerAction(id: number) {
  const trpc = await getServerTrpc()
  return (await loadPlayerWithReference(trpc, id)).player
}

export async function refreshPlayerAction(id: number, turnstileToken: string) {
  const trpc = await getServerTrpc()
  return await trpc.player.refresh.mutate({ id, turnstileToken })
}
