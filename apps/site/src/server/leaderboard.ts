import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { parseMode, parseRegion } from '../components/home/home-filters'
import { regionCookieName } from '../components/home/region-cookie'
import { lastLeaderboardPage } from '../components/leaderboard/leaderboard-search'
import { parsePage } from '../components/page-number'
import { type LeaderboardRequest, leaderboardForVisitor } from './visitor-leaderboard'

function parseLeaderboardRequest(request: LeaderboardRequest): LeaderboardRequest {
  const page = parsePage(request.page, lastLeaderboardPage) ?? 1

  return { mode: parseMode(request.mode), region: parseRegion(request.region), page }
}

// the remembered region is read here, so the first html already shows the visitor's board
export const getLeaderboardPage = createServerFn({ method: 'GET' })
  .validator(parseLeaderboardRequest)
  .handler(({ data }) => leaderboardForVisitor(data, getCookie(regionCookieName)))
