import type { Metadata } from 'next'

import { WorkInProgress } from '@/components/WorkInProgress'

export const metadata: Metadata = {
  title: 'Learn - Coming Soon',
}

export default function Page() {
  return <WorkInProgress slug="learn" />
}
