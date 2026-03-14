import { blacklist, player, ranked2v2Team } from '@brawltome/database'
import { and, asc, desc, gt, inArray, not, sql } from 'drizzle-orm'
import type { Context } from '../trpc/context'

const MAX_PAGES = 200
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

type SortField = 'rating' | 'peakRating' | 'wins' | 'games'
type SortOrder = 'asc' | 'desc'

interface LeaderboardInput {
  bracket: '1v1' | '2v2'
  region: string
  page: number
  pageSize?: number
  sort?: SortField
  order?: SortOrder
}

export async function getLeaderboard(ctx: Context, input: LeaderboardInput) {
  const page = Math.max(1, Math.min(input.page, MAX_PAGES))
  const pageSize = Math.max(1, Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const sort = input.sort ?? 'rating'
  const order = input.order ?? 'desc'
  const offset = (page - 1) * pageSize

  if (input.bracket === '2v2') {
    return get2v2Leaderboard(ctx, { ...input, page, pageSize, sort, order, offset })
  }

  return get1v1Leaderboard(ctx, { ...input, page, pageSize, sort, order, offset })
}

async function get1v1Leaderboard(
  ctx: Context,
  opts: LeaderboardInput & { pageSize: number; sort: SortField; order: SortOrder; offset: number },
) {
  const blacklistedIds = await ctx.db.select({ brawlhallaId: blacklist.brawlhallaId }).from(blacklist)
  const blacklistSet = new Set(blacklistedIds.map((b) => b.brawlhallaId))

  const sortColumn = {
    rating: player.rating,
    peakRating: player.peakRating,
    wins: player.rankedWins,
    games: player.rankedGames,
  }[opts.sort]

  const orderFn = opts.order === 'asc' ? asc : desc

  const regionFilter = opts.region !== 'all' ? sql`${player.region} = ${opts.region}` : undefined

  const results = await ctx.db
    .select()
    .from(player)
    .where(
      and(
        gt(player.rating, 0),
        regionFilter,
        blacklistSet.size > 0 ? not(inArray(player.brawlhallaId, [...blacklistSet])) : undefined,
      ),
    )
    .orderBy(orderFn(sortColumn))
    .limit(opts.pageSize)
    .offset(opts.offset)

  return {
    entries: results,
    page: opts.page,
    pageSize: opts.pageSize,
  }
}

async function get2v2Leaderboard(
  ctx: Context,
  opts: LeaderboardInput & { pageSize: number; sort: SortField; order: SortOrder; offset: number },
) {
  const blacklistedIds = await ctx.db.select({ brawlhallaId: blacklist.brawlhallaId }).from(blacklist)
  const blacklistSet = new Set(blacklistedIds.map((b) => b.brawlhallaId))

  const sortColumn = {
    rating: ranked2v2Team.rating,
    peakRating: ranked2v2Team.peakRating,
    wins: ranked2v2Team.wins,
    games: ranked2v2Team.games,
  }[opts.sort]

  const orderFn = opts.order === 'asc' ? asc : desc
  const regionFilter = opts.region !== 'all' ? sql`${ranked2v2Team.region} = ${opts.region}` : undefined

  const results = await ctx.db
    .select()
    .from(ranked2v2Team)
    .where(and(regionFilter))
    .orderBy(orderFn(sortColumn))
    .limit(opts.pageSize)
    .offset(opts.offset)

  // Filter blacklisted teams
  const filtered = results.filter((t) => !blacklistSet.has(t.brawlhallaIdOne) && !blacklistSet.has(t.brawlhallaIdTwo))

  // Enrich with player names
  const playerIds = [...new Set(filtered.flatMap((t) => [t.brawlhallaIdOne, t.brawlhallaIdTwo]))]
  let nameMap = new Map<number, string>()

  if (playerIds.length > 0) {
    const players = await ctx.db
      .select({ brawlhallaId: player.brawlhallaId, name: player.name })
      .from(player)
      .where(inArray(player.brawlhallaId, playerIds))

    nameMap = new Map(players.map((p) => [p.brawlhallaId, p.name]))
  }

  const entries = filtered.map((t, i) => ({
    ...t,
    rank: opts.offset + i + 1,
    playerOneName: nameMap.get(t.brawlhallaIdOne),
    playerTwoName: nameMap.get(t.brawlhallaIdTwo),
  }))

  return {
    entries,
    page: opts.page,
    pageSize: opts.pageSize,
  }
}
