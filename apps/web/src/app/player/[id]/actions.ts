'use server'

import { loadPlayerWithReference } from '@/lib/player-reference'
import { getServerActionTrpc, getServerTrpc } from '@/lib/trpc-server'

export async function getPlayerAction(id: number) {
  const trpc = await getServerTrpc()
  return (await loadPlayerWithReference(trpc, id)).player
}

export async function refreshPlayerAction(id: number, turnstileToken?: string) {
  const trpc = await getServerActionTrpc()
  return await trpc.player.requestRefresh.mutate({ id, turnstileToken })
}
