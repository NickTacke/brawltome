import type { Metadata } from 'next'

import { WorkInProgress } from '@/components/WorkInProgress'

export const metadata: Metadata = {
  title: 'Statistics - Coming Soon',
}

export default function Page() {
  return <WorkInProgress slug="stats" />
}
