import { PlayerProfile } from '@/components/player/PlayerProfile'
import { trpc } from '@/lib/trpc'
import { fixEncoding } from '@/lib/utils'
import { Card } from '@brawltome/ui'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const getPlayer = cache(async (id: number) => {
  try {
    return await trpc.player.byId.query({ id })
  } catch {
    return null
  }
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const player = await getPlayer(Number(id))

  if (!player) return { title: 'Player Not Found' }

  const playerName = fixEncoding(player.name)
  const description = `Rating: ${player.rating} / ${player.peakRating} (peak) | Games: ${player.rankedWins}W / ${(player.rankedGames ?? 0) - (player.rankedWins ?? 0)}L`

  return {
    title: playerName,
    description,
    openGraph: {
      title: `${playerName} | BrawlTome`,
      description,
      url: `https://brawltome.app/player/${id}`,
    },
  }
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  const initialData = await getPlayer(Number(id))

  if (!initialData) notFound()

  return (
    <main className="min-h-screen bg-background py-6">
      <PlayerProfile initialData={initialData} id={id} />
    </main>
  )
}
