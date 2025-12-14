import { fetcher } from '@/lib/api';
import { PlayerProfile } from '@/components/player/PlayerProfile';
import { notFound } from 'next/navigation';
import { Card } from '@brawltome/ui';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function Page({ params }: PageProps) {
  // Fetch initial data
  const { id } = await params;

  let initialData;
  try {
    initialData = await fetcher(`/player/${id}`);
  } catch (err: unknown) {
    const error = err as Error & { cause?: string };
    if (error.cause === 'Too Many Requests') {
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
