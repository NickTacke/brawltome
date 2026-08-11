import { CareerWeaponUsage, CareerWeaponUsageLoadError } from '@/components/statistics/CareerWeaponUsage'
import { type CareerWeaponUsageSearchParams, parseCareerWeaponUsageFilters } from '@/components/statistics/filters'
import { getServerTrpc } from '@/lib/trpc-server'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Career Weapon Usage',
  description: 'Validated career weapon-held observations from the BrawlTome Observed Cohort.',
}

interface PageProps {
  searchParams: Promise<CareerWeaponUsageSearchParams>
}

export default async function Page({ searchParams }: PageProps) {
  const filters = parseCareerWeaponUsageFilters(await searchParams)
  try {
    const trpc = await getServerTrpc()
    const [viewResult, historyResult] = await Promise.allSettled([
      trpc.statistics.careerWeaponUsage.query(filters),
      trpc.statistics.careerWeaponUsageHistory.query(filters),
    ])
    if (viewResult.status === 'rejected') {
      console.error('[statistics] failed to load Career Weapon Usage', viewResult.reason)
      return <CareerWeaponUsageLoadError filters={filters} />
    }
    if (historyResult.status === 'rejected') {
      console.error('[statistics] failed to load Career Weapon Usage history', historyResult.reason)
    }
    return (
      <CareerWeaponUsage
        view={viewResult.value}
        history={historyResult.status === 'fulfilled' ? historyResult.value : undefined}
        historyError={historyResult.status === 'rejected' ? 'The snapshot history request failed.' : undefined}
      />
    )
  } catch (error) {
    console.error('[statistics] failed to initialize Career Weapon Usage queries', error)
    return <CareerWeaponUsageLoadError filters={filters} />
  }
}
