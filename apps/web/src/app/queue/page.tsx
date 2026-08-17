import { QueueLoadError, QueueView } from '@/components/Queue'
import {
  PAGE_SIZE,
  QUEUE_PREFERENCE_COOKIE,
  type QueueSearchParams,
  parseQueuePreference,
  parseQueueSearchParams,
} from '@/components/Queue/utils'
import { getServerTrpc } from '@/lib/trpc-server'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Queue',
  description: 'Recent ranked activity inferred from leaderboard changes.',
}

interface PageProps {
  searchParams: Promise<QueueSearchParams>
}

export default async function Page({ searchParams }: PageProps) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()])
  const remembered = parseQueuePreference(cookieStore.get(QUEUE_PREFERENCE_COOKIE)?.value)
  const filters = parseQueueSearchParams(params, remembered)
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
