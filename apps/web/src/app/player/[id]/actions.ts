'use server'

import { getServerTrpc } from '@/lib/trpc-server'

export async function getPlayerAction(id: number, turnstileToken?: string) {
  const trpc = await getServerTrpc(turnstileToken)
  return await trpc.player.byId.query({ id })
}
