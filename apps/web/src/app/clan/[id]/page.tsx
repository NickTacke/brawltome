import { trpc } from '@/lib/trpc'
import { ClanProfile } from '@/components/clan/ClanProfile'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { cache } from 'react'
import { fixEncoding } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const getClan = cache(async (id: number) => {
  try {
    return await trpc.clan.byId.query({ id })
  } catch {
    return null
  }
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const clan = await getClan(Number(id))

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
  const initialData = await getClan(Number(id))

  if (!initialData) notFound()

  return (
    <main className="min-h-screen bg-background py-6">
      <ClanProfile initialData={initialData} id={id} />
    </main>
  )
}
