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

// Counts the view as background refresh demand. Best effort: a failure never affects the page.
export async function recordProfileViewAction(id: number) {
  try {
    const trpc = await getServerActionTrpc()
    await trpc.player.recordView.mutate({ id })
  } catch {
    return
  }
}
