import type { MatchUsage } from './app-status'
import { percentText, requestText } from './usage-format'

// what the app itself used during the last match, read from windows' totals at its start and end
export function MatchUsageLine({ usage }: { usage: MatchUsage }) {
  return (
    <p className="usage">
      Last match<span className="dot">·</span>
      {percentText(usage.cpuPercent)} CPU<span className="dot">·</span>
      {usage.ramMb} MB<span className="dot">·</span>
      {requestText(usage.requestCount)}
    </p>
  )
}
