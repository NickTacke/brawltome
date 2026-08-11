'use client'

import { trpc } from '@/lib/trpc'
import type { LegendMetaInput } from '@brawltome/contracts'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { LegendMetaHistory } from './LegendMetaHistory'
import { LegendMetaView } from './LegendMetaView'
import { buildLegendMetaQueryString, parseLegendMetaSearchParams } from './utils'

export function LegendMeta() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filters = useMemo(
    () => parseLegendMetaSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  )
  const { data, error } = useQuery({
    queryKey: ['statistics', 'legend-meta', filters.region, filters.bracket],
    queryFn: () => trpc.statistics.legendMeta.query(filters),
  })
  const history = useQuery({
    queryKey: ['statistics', 'legend-meta-history', filters.region, filters.bracket],
    queryFn: () => trpc.statistics.legendMetaHistory.query(filters),
  })

  const updateFilters = useCallback(
    (next: LegendMetaInput) => {
      router.push(`${pathname}?${buildLegendMetaQueryString(next)}`, { scroll: false })
    },
    [pathname, router],
  )

  if (error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-3xl rounded-xl border border-destructive/50 bg-destructive/10 p-6 text-center"
      >
        <h1 className="text-xl font-semibold text-foreground">Unable to load Legend Meta</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'Unknown transport failure'}
        </p>
      </div>
    )
  }

  if (!data) {
    return (
      <output
        aria-live="polite"
        className="mx-auto block max-w-3xl rounded-xl border border-border bg-card/60 p-8 text-center text-muted-foreground"
      >
        Loading Current Season Legend Meta…
      </output>
    )
  }

  return (
    <div className="space-y-10">
      <LegendMetaView data={data} region={filters.region} bracket={filters.bracket} onFilterChange={updateFilters} />
      <LegendMetaHistory
        history={history.data}
        error={
          history.error instanceof Error
            ? history.error.message
            : history.error
              ? 'Unknown transport failure'
              : undefined
        }
        loading={history.isLoading}
      />
    </div>
  )
}
