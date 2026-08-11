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
    const view = await trpc.statistics.careerWeaponUsage.query(filters)
    return <CareerWeaponUsage view={view} />
  } catch (error) {
    console.error('[statistics] failed to load Career Weapon Usage', error)
    return <CareerWeaponUsageLoadError filters={filters} />
  }
}
