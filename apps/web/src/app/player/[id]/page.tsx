import { PlayerProfile } from '@/components/player/PlayerProfile'
import { getServerTrpc } from '@/lib/trpc-server'
import { fixEncoding } from '@/lib/utils'
import type { Metadata } from 'next'
import { cache } from 'react'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const getPlayer = cache(async (id: number) => {
  try {
    const trpc = await getServerTrpc()
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
  const playtimeHours = player.matchTimeTotal ? Math.round((player.matchTimeTotal / 3600) * 10) / 10 : 0
  const playtimeStr = Number.isInteger(playtimeHours) ? `${playtimeHours}h` : `${playtimeHours.toFixed(1)}h`
  const wins = player.rankedWins ?? 0
  const games = player.rankedGames ?? 0
  const losses = games - wins
  const winRate = games > 0 ? ((wins / games) * 100).toFixed(1) : '0'

  const description = [
    `Playtime: ${playtimeStr}`,
    `Elo: ${player.rating} / ${player.peakRating} (peak)`,
    `Games: ${wins}W / ${losses}L (WR: ${winRate}%)`,
  ].join('\n')

  const mostPlayed = (player.statsLegends || []).reduce(
    (max: { games?: number; legendNameKey?: string } | null, l: { games?: number; legendNameKey?: string }) =>
      !max || (l.games || 0) > (max.games || 0) ? l : max,
    null,
  )
  const legendKey = mostPlayed?.legendNameKey?.toLowerCase() || ''

  return {
    title: playerName,
    description,
    openGraph: {
      title: `${playerName} | BrawlTome`,
      description,
      url: `https://brawltome.app/player/${id}`,
      images: legendKey
        ? [
            {
              url: `/images/legends/avatars/${encodeURIComponent(legendKey)}.png`,
              width: 200,
              height: 200,
              alt: legendKey,
            },
          ]
        : [{ url: '/og-image.png', alt: 'BrawlTome' }],
    },
    twitter: {
      card: 'summary',
      title: `${playerName} | BrawlTome`,
      description,
      images: legendKey ? [`/images/legends/avatars/${encodeURIComponent(legendKey)}.png`] : ['/og-image.png'],
    },
  }
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  const initialData = await getPlayer(Number(id))

  return (
    <main className="min-h-screen bg-background py-6">
      <PlayerProfile initialData={initialData} id={id} />
    </main>
  )
}
