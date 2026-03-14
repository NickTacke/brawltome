import { blacklist, player, playerRankedTeam } from '@brawltome/database'
import { and, asc, desc, gt, inArray, not, sql } from 'drizzle-orm'
import type { Context } from '../trpc/context'
import { getLegendById } from './game-data.service'

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

  const entries = results.map((entry) => ({
    ...entry,
    bestLegendNameKey: getLegendById(entry.bestLegend)?.legendNameKey ?? null,
  }))

  return {
    entries,
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
    rating: playerRankedTeam.rating,
    peakRating: playerRankedTeam.peakRating,
    wins: playerRankedTeam.wins,
    games: playerRankedTeam.games,
  }[opts.sort]

  const orderFn = opts.order === 'asc' ? asc : desc
  const regionFilter = opts.region !== 'all' ? sql`${playerRankedTeam.region} = ${opts.region}` : undefined

  // Deduplicate teams by canonicalizing ID pair (min, max)
  // Use a subquery to pick the best row per unique team pair
  const results = await ctx.db
    .select()
    .from(playerRankedTeam)
    .where(and(gt(playerRankedTeam.rating, 0), regionFilter))
    .orderBy(orderFn(sortColumn))
    .limit(opts.pageSize * 2) // Fetch extra to account for dedup
    .offset(opts.offset)

  // Deduplicate in application: canonicalize (min, max) pair
  const seen = new Set<string>()
  const deduped = results.filter((t) => {
    const min = Math.min(t.brawlhallaIdOne, t.brawlhallaIdTwo)
    const max = Math.max(t.brawlhallaIdOne, t.brawlhallaIdTwo)
    const key = `${min}:${max}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Filter blacklisted and take page size
  const filtered = deduped
    .filter((t) => !blacklistSet.has(t.brawlhallaIdOne) && !blacklistSet.has(t.brawlhallaIdTwo))
    .slice(0, opts.pageSize)

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

  const entries = filtered.map((t, i) => {
    const nameParts = (t.teamName ?? '').split('+')
    return {
      ...t,
      rank: opts.offset + i + 1,
      playerOneName: nameMap.get(t.brawlhallaIdOne) ?? nameParts[0]?.trim() ?? 'Unknown',
      playerTwoName: nameMap.get(t.brawlhallaIdTwo) ?? nameParts[1]?.trim() ?? 'Unknown',
    }
  })

  return {
    entries,
    page: opts.page,
    pageSize: opts.pageSize,
  }
}
