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

    const topLegend = player.legends?.[0];
    const legendName = topLegend?.legend_name_key?.toLowerCase() || '';
    const encodedLegendName = encodeURIComponent(legendName);
    const description = `${player.tier} (${player.rating} ELO)${topLegend ? ` - Top legend: ${topLegend.legend_name_key}` : ''}`;

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
                alt: `${topLegend.legend_name_key} avatar`,
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
