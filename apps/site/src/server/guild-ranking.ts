import { createServerFn } from '@tanstack/react-start'
import { lastGuildRankingPage } from '../components/guilds/guild-ranking-search'
import { parsePage } from '../components/page-number'
import { loadGuildRanking } from './load-guild-ranking'

export const getGuildRanking = createServerFn({ method: 'GET' })
  .validator((page: number) => parsePage(page, lastGuildRankingPage) ?? 1)
  .handler(({ data: page }) => loadGuildRanking(page))
