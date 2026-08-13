import { ClanProfile } from '@/components/clan/ClanProfile'
import { getServerTrpc } from '@/lib/trpc-server'
import { fixEncoding } from '@/lib/utils'
import type { Metadata } from 'next'
import { cache } from 'react'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const parseClanId = (value: string): number | null => {
  if (!/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null
}

const getClan = cache(async (id: number) => {
  try {
    const trpc = await getServerTrpc()
    return await trpc.clan.byId.query({ id })
  } catch {
    return null
  }
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const clanId = parseClanId(id)
  const clan = clanId === null ? null : await getClan(clanId)

  if (!clan) return { title: 'Clan Not Found' }

  const memberCount = clan.members?.length || 0
  const description = `${memberCount} members`

  return {
    title: fixEncoding(clan.clanName),
    description,
    openGraph: {
      title: `${fixEncoding(clan.clanName)} | BrawlTome`,
      description,
      url: `https://brawltome.app/clan/${id}`,
    },
  }
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  const clanId = parseClanId(id)
  const initialData = clanId === null ? null : await getClan(clanId)

  return (
    <div className="space-y-8">
      <ClanProfile initialData={initialData} id={id} />
    </div>
  )
}
