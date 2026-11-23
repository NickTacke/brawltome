import { Link } from '@tanstack/react-router'

// legends joins once ranked coverage fills its board; a tab with nothing behind it would be a dead end
const tabs = [
  { to: '/leaderboard', label: 'Players' },
  { to: '/leaderboard/guilds', label: 'Guilds' },
] as const

export type LeaderboardTab = (typeof tabs)[number]['label']

// the shown tab is marked by colour, like a chosen filter, not by a bar
export function LeaderboardTabs({ current }: { current: LeaderboardTab }) {
  return (
    <nav aria-label="Leaderboards" className="flex gap-6">
      {tabs.map((tab) => {
        const isCurrent = tab.label === current

        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={isCurrent ? 'page' : undefined}
            className={`text-xl font-bold transition-colors ${isCurrent ? 'text-strong' : 'text-soft hover:text-text'}`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
