import type { Metadata } from 'next'

import { WorkInProgress } from '@/components/WorkInProgress'

export const metadata: Metadata = {
  title: 'Feed - Coming Soon',
}

export default function Page() {
  return <WorkInProgress slug="feed" />
}
