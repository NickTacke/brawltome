'use server'

import { getServerTrpc } from '@/lib/trpc-server'

export async function getPlayerAction(id: number) {
  const trpc = await getServerTrpc()
  return await trpc.player.byId.query({ id })
}
