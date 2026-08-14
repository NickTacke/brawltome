import type { Metadata } from 'next'
import { Suspense } from 'react'

import { LearnHub } from './LearnHub'

export const metadata: Metadata = {
  title: 'Learn',
  description: 'Master Brawlhalla — curated guides, weapon breakdowns, and rank-tailored paths.',
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LearnHub />
    </Suspense>
  )
}
