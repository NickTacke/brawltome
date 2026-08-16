import type { Metadata } from 'next'
import { ReplayAnalysisPage } from './ReplayAnalysisPage'

export const metadata: Metadata = {
  title: 'Replay Analysis',
  description: 'Upload a Brawlhalla replay and inspect native match statistics.',
}

export default function Page() {
  return <ReplayAnalysisPage />
}
