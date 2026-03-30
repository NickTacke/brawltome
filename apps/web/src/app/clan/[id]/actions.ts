'use server'

import { getServerTrpc } from '@/lib/trpc-server'

export async function getClanAction(id: number, turnstileToken?: string) {
  const trpc = await getServerTrpc(turnstileToken)
  return await trpc.clan.byId.query({ id })
}
