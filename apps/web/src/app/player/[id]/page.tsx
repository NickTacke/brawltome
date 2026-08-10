import { PlayerProfile } from '@/components/player/PlayerProfile'
import { loadPlayerWithReference } from '@/lib/player-reference'
import { getServerTrpc } from '@/lib/trpc-server'
import { fixEncoding } from '@/lib/utils'
import type { Metadata } from 'next'
import { cache } from 'react'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const getPlayerPageData = cache(async (id: number) => {
  const trpc = await getServerTrpc()
  return loadPlayerWithReference(trpc, id)
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const { player } = await getPlayerPageData(Number(id))

  if (!player) return { title: 'Player Not Found' }

  const playerName = fixEncoding(player.name)
  const matchTime = player.career?.snapshot?.combat.matchTime
  const playtimeHours = typeof matchTime === 'number' ? Math.round((matchTime / 3600) * 10) / 10 : null
  const playtimeStr =
    playtimeHours === null
      ? null
      : Number.isInteger(playtimeHours)
        ? `${playtimeHours}h`
        : `${playtimeHours.toFixed(1)}h`
  const ranked = player.currentSeason?.snapshot?.oneVsOne
  const description = [
    playtimeStr ? `Lifetime playtime: ${playtimeStr}` : null,
    ranked
      ? `Current Season Elo: ${ranked.rating} / ${ranked.peakRating} (peak)`
      : 'Current Season ranked data unavailable',
    ranked ? `Current Season Games: ${ranked.wins}W / ${ranked.games - ranked.wins}L` : null,
  ]
    .filter((fact): fact is string => fact !== null)
    .join('\n')

  const legendKey = player.currentSeason?.snapshot?.mainLegend?.legendNameKey.toLowerCase() || ''

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
  const { player: initialData } = await getPlayerPageData(Number(id))

  return (
    <div className="space-y-8">
      <PlayerProfile initialData={initialData} id={id} />
    </div>
  )
}
