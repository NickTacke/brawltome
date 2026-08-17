'use client'

import type { ReplayJobDetailContract } from '@brawltome/contracts'
import { ReplayReportView } from './ReplayReportView'
import { replayReportFromJob } from './replay-report'

export { formatDuration, timelineX } from './ReplayReportCharts'

export function ReplayResultView({ job }: { job: ReplayJobDetailContract }) {
  const report = replayReportFromJob(job)
  return report ? <ReplayReportView report={report} /> : null
}
