import { fetcher } from '@/lib/api';
import { PlayerProfile } from '@/components/player/PlayerProfile';
import { notFound } from 'next/navigation';
import { Card } from '@brawltome/ui';
import type { Metadata } from 'next';
import { cache } from 'react';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Cache the player fetcher to avoid duplicate requests within the same render
const getPlayer = cache(async (id: string) => fetcher(`/player/${id}`));

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const player = await getPlayer(id);

    if (!player) {
      return { title: 'Player Not Found' };
    }

    // Find most played legend by games
    const statsLegends = player.stats?.legends || [];
    const mostPlayedLegend = statsLegends.reduce(
      (
        max: { games?: number; legendNameKey?: string } | null,
        legend: { games?: number; legendNameKey?: string },
      ) => (!max || (legend.games || 0) > (max.games || 0) ? legend : max),
      null,
    );

    const legendName = mostPlayedLegend?.legendNameKey?.toLowerCase() || '';
    const encodedLegendName = encodeURIComponent(legendName);

    // Format playtime
    const playtimeSeconds =
      player.stats?.playtimeSeconds ?? player.stats?.matchTimeTotal ?? 0;
    const hours = Math.round((playtimeSeconds / 3600) * 10) / 10;
    const playtimeStr = Number.isInteger(hours)
      ? `${hours}h`
      : `${hours.toFixed(1)}h`;

    // Format win rate
    const games = player.games || 0;
    const wins = player.wins || 0;
    const losses = games - wins;
    const winRate = games > 0 ? ((wins / games) * 100).toFixed(1) : '0';

    // Build description
    const description = [
      `Playtime: ${playtimeStr}`,
      `Elo: ${player.rating || 0}/${player.peakRating || 0} (peak)`,
      `Games: ${wins}W / ${losses}L (WR: ${winRate}%)`,
    ].join('\n');

    return {
      title: player.name,
      description,
      openGraph: {
        title: `${player.name} | BrawlTome`,
        description,
        url: `https://brawltome.app/player/${id}`,
        images: legendName
          ? [
              {
                url: `/images/legends/avatars/${encodedLegendName}.png`,
                width: 200,
                height: 200,
                alt: `${mostPlayedLegend?.legendNameKey} avatar`,
              },
            ]
          : [
              {
                url: '/og-image.png',
                alt: 'BrawlTome',
              },
            ],
      },
      twitter: {
        card: 'summary',
        title: `${player.name} | BrawlTome`,
        description,
        images: legendName
          ? [`/images/legends/avatars/${encodedLegendName}.png`]
          : ['/og-image.png'],
      },
    };
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    if (error.status === 429) {
      return { title: 'Server Busy' };
    }
    return { title: 'Player Not Found' };
  }
}

export default async function Page({ params }: PageProps) {
  // Fetch initial data
  const { id } = await params;

  let initialData;
  try {
    initialData = await getPlayer(id);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    if (error.status === 429) {
      return (
        <main className="min-h-screen bg-background py-10 flex items-center justify-center">
          <Card className="p-8 text-center max-w-md">
            <h1 className="text-2xl font-bold mb-4 text-destructive">
              Server Busy
            </h1>
            <p className="text-muted-foreground mb-4">
              We are experiencing high traffic and cannot fetch new player data
              at this time. Please try again later.
            </p>
          </Card>
        </main>
      );
    }
    throw err;
  }

  if (!initialData) {
    notFound();
  }

  // Pass to client component
  return (
    <main className="min-h-screen bg-background py-6">
      <PlayerProfile initialData={initialData} id={id} />
    </main>
  );
}
