import { QueueLoadError, QueueView } from '@/components/Queue'
import { PAGE_SIZE, type QueueSearchParams, parseQueueSearchParams } from '@/components/Queue/utils'
import { getServerTrpc } from '@/lib/trpc-server'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Queue',
  description: 'Recent ranked activity inferred from leaderboard changes.',
}

interface PageProps {
  searchParams: Promise<QueueSearchParams>
}

export default async function Page({ searchParams }: PageProps) {
  const filters = parseQueueSearchParams(await searchParams)
  try {
    const trpc = await getServerTrpc()
    const view = await trpc.leaderboard.recentActivity.query({
      mode: filters.mode,
      region: filters.region,
      page: filters.page,
      pageSize: PAGE_SIZE,
      snapshotId: filters.snapshotId,
    })
    return <QueueView view={view} filters={filters} />
  } catch (error) {
    console.error('[queue route]', error)
    return <QueueLoadError filters={filters} />
  }
}
