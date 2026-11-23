import { createFileRoute, redirect } from '@tanstack/react-router'
import { parseGuildRankingSearch } from '../components/guilds/guild-ranking-search'

// the guild ranking moved under the leaderboards; old links and bookmarks still land on it
export const Route = createFileRoute('/guilds')({
  validateSearch: parseGuildRankingSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/leaderboard/guilds', search, statusCode: 301 })
  },
})
