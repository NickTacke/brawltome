import type { ReactNode } from 'react'
import { type LeaderboardTab, LeaderboardTabs } from './LeaderboardTabs'

type LeaderboardHeaderProps = { tab: LeaderboardTab; filters?: ReactNode; pager?: ReactNode }

// right padding on small screens leaves room for the menu button. the filters and the top pager sit on the tab row,
// right above the table they change
export function LeaderboardHeader({ tab, filters, pager }: LeaderboardHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="pr-11 text-3xl font-black tracking-tight text-strong sm:text-5xl md:pr-0">Leaderboards</h1>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <LeaderboardTabs current={tab} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {filters}
          {pager}
        </div>
      </div>
    </div>
  )
}
