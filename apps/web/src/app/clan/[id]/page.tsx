import { fetcher } from '@/lib/api';
import { ClanProfile } from '@/components/clan/ClanProfile';
import { notFound } from 'next/navigation';
import { Card } from '@brawltome/ui';
import type { Metadata } from 'next';
import { cache } from 'react';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Cache the clan fetcher to avoid duplicate requests within the same render
const getClan = cache(async (id: string) => fetcher(`/clan/${id}`));

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const clan = await getClan(id);

    if (!clan) {
      return { title: 'Clan Not Found' };
    }

    const memberCount = clan.clan?.length || 0;
    const xp = parseInt(clan.clan_xp || '0', 10).toLocaleString();
    const description = `${memberCount} members - Clan XP: ${xp}`;

    return {
      title: clan.clan_name,
      description,
      openGraph: {
        title: `${clan.clan_name} | BrawlTome`,
        description,
        url: `https://brawltome.app/clan/${id}`,
        images: ['/og-image.png'],
      },
      twitter: {
        card: 'summary',
        title: `${clan.clan_name} | BrawlTome`,
        description,
      },
    };
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    if (error.status === 429) {
      return { title: 'Server Busy' };
    }
    return { title: 'Clan Not Found' };
  }
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;

  let initialData;
  try {
    initialData = await getClan(id);
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
              We are experiencing high traffic and cannot fetch clan data at
              this time. Please try again later.
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

  return (
    <main className="min-h-screen bg-background py-6">
      <ClanProfile initialData={initialData} id={id} />
    </main>
  );
}
