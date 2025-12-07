import { fetcher } from '@/lib/api';
import { PlayerProfile } from '@/components/player/PlayerProfile';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: { id: string };
}

export default async function Page({ params }: PageProps) {
    // Fetch initial data
    const { id } = await params;
    const initialData = await fetcher(`/player/${id}`);

    if(!initialData) {
        notFound();
    }

    // Pass to client component
    return (
        <main className="min-h-screen bg-background py-10">
            <PlayerProfile initialData={initialData} id={id} />
        </main>
    );
}