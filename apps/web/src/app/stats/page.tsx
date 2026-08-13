import { LegendMeta } from '@/components/statistics/LegendMeta'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

export const metadata: Metadata = {
  title: 'Current Season Legend Meta',
  description:
    'BrawlTome-observed current-season ranked 1v1 legend statistics with disclosed coverage and methodology.',
}

export default function Page() {
  return (
    <div className="space-y-6">
      <nav aria-label="Statistics views" className="flex flex-wrap gap-2 border-b border-border pb-4">
        <Link href="/stats" aria-current="page" className="rounded-md bg-muted px-3 py-2 text-sm font-semibold">
          Legend Meta
        </Link>
        <Link
          href="/stats/career-weapon-usage"
          className="rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Career Weapon Usage
        </Link>
      </nav>
      <Suspense
        fallback={
          <output className="mx-auto block max-w-3xl rounded-xl border border-border bg-card/60 p-8 text-center text-muted-foreground">
            Loading Current Season Legend Meta…
          </output>
        }
      >
        <LegendMeta />
      </Suspense>
    </div>
  )
}
