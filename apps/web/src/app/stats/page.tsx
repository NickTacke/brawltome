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
    <main className="min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <nav aria-label="Statistics views" className="mx-auto mb-4 max-w-7xl text-right">
        <Link href="/stats/career-weapon-usage" className="font-semibold text-primary hover:underline">
          View Career Weapon Usage
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
    </main>
  )
}
