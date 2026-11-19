import type { MatchSummaryContract, MyMatchesContract } from '@brawltome/contracts'
import type { Sql } from '@brawltome/foundation'
import { legendNamesOf } from '@brawltome/match-insights'
import type { MapPictures } from './map-picture'
import { winningSlots } from './match-result'
import { type SummaryRow, summaryOf, summaryPlayersOf } from './match-summary'

// the match lists: a player's matches, everyone's latest, and a player's record across all of theirs. newest
// upload first, as no replay says when it was played

export type MatchListDeps = { sql: Sql; mapPictures: MapPictures }

export type MatchPage = { matches: MatchSummaryContract[]; nextCursor: string | null }

const pageSize = 20

/** A player's matches; the cursor continues where the previous page stopped. */
export function listPlayerMatches(deps: MatchListDeps, brawlhallaId: number, cursor?: string): Promise<MatchPage> {
  return listMatches(deps, brawlhallaId, cursor)
}

/** Every uploaded match, newest first. */
export function listRecentMatches(deps: MatchListDeps, cursor?: string): Promise<MatchPage> {
  return listMatches(deps, null, cursor)
}

// one player's matches, or everyone's with no player given
async function listMatches(deps: MatchListDeps, brawlhallaId: number | null, cursorValue?: string): Promise<MatchPage> {
  const { sql } = deps
  const cursor = decodeCursor(cursorValue)

  const playedIn =
    brawlhallaId === null
      ? sql``
      : sql`AND EXISTS (SELECT 1 FROM replays.match_players AS player
          WHERE player.match_id = match.id AND player.brawlhalla_id = ${brawlhallaId})`

  const rows = await sql<SummaryRow[]>`
    SELECT match.id, match.patch, match.map_id AS "mapId", match.map_name AS "mapName", match.mode_name AS "modeName",
      match.queue, match.is_ranked AS "isRanked", match.is_custom AS "isCustom", match.has_teams AS "hasTeams",
      match.stocks, match.duration_ms AS "durationMs", match.parsed_at AS "parsedAt"
    FROM replays.matches AS match
    WHERE match.merged_into IS NULL ${playedIn}
      ${cursor ? sql`AND (match.parsed_at, match.id) < (${cursor.parsedAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
    ORDER BY match.parsed_at DESC, match.id DESC
    LIMIT ${pageSize + 1}
  `

  const page = rows.slice(0, pageSize)

  const players = await summaryPlayersOf(
    sql,
    page.map((row) => row.id),
  )

  const matches = await Promise.all(
    page.map(async (row) => {
      const ofMatch = players.filter((player) => player.matchId === row.id)

      return summaryOf(row, ofMatch, await deps.mapPictures(row.patch, row.mapId))
    }),
  )

  const last = page.at(-1)
  const hasMore = rows.length > pageSize && last

  return { matches, nextCursor: hasMore ? encodeCursor({ parsedAt: last.parsedAt.toISOString(), id: last.id }) : null }
}

type RecordLine = {
  matchId: string
  hasTeams: boolean
  parsedAt: Date
  slot: number
  brawlhallaId: number
  team: number
  deaths: number
  score: number | null
  legendId: number
  legendName: string
}

/** How a player did across every uploaded match they played in: games, wins and each legend they played. */
export async function readMatchRecord(sql: Sql, brawlhallaId: number): Promise<MyMatchesContract['record']> {
  const lines = await sql<RecordLine[]>`
    SELECT player.match_id AS "matchId", match.has_teams AS "hasTeams", match.parsed_at AS "parsedAt", player.slot,
      player.brawlhalla_id AS "brawlhallaId", player.team, player.deaths, player.score, player.legend_id AS "legendId",
      player.legend_name AS "legendName"
    FROM replays.match_players AS player
    JOIN replays.matches AS match ON match.id = player.match_id
    WHERE match.merged_into IS NULL AND player.match_id IN (
      SELECT match_id FROM replays.match_players WHERE brawlhalla_id = ${brawlhallaId}
    )
  `

  return recordOf(
    lines.map((line) => ({ ...line, brawlhallaId: Number(line.brawlhallaId) })),
    brawlhallaId,
  )
}

/** The record from every player's line in the player's matches; kept apart from the query so it can be tested. */
export function recordOf(lines: RecordLine[], brawlhallaId: number): MyMatchesContract['record'] {
  const legends = new Map<number, MyMatchesContract['record']['legends'][number]>()
  let games = 0
  let wins = 0
  let lastParsedAt: Date | null = null

  for (const matchLines of groupByMatch(lines).values()) {
    const own = matchLines.find((line) => line.brawlhallaId === brawlhallaId)

    if (!own) continue

    const isWin = winningSlots(matchLines, own.hasTeams).has(own.slot)
    const names = legendNamesOf({ id: own.legendId, name: own.legendName })
    const legend = legends.get(own.legendId) ?? { legendId: own.legendId, ...names, games: 0, wins: 0 }

    games += 1
    wins += isWin ? 1 : 0
    legends.set(own.legendId, { ...legend, games: legend.games + 1, wins: legend.wins + (isWin ? 1 : 0) })

    if (!lastParsedAt || own.parsedAt > lastParsedAt) lastParsedAt = own.parsedAt
  }

  const byGames = [...legends.values()].sort((left, right) => right.games - left.games || right.wins - left.wins)

  return { games, wins, lastParsedAt: lastParsedAt?.toISOString() ?? null, legends: byGames }
}

function groupByMatch(lines: RecordLine[]): Map<string, RecordLine[]> {
  const byMatch = new Map<string, RecordLine[]>()

  for (const line of lines) byMatch.set(line.matchId, [...(byMatch.get(line.matchId) ?? []), line])

  return byMatch
}

type Cursor = { parsedAt: string; id: string }

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.parsedAt}|${cursor.id}`).toString('base64url')
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// a cursor that doesn't decode to a date and an id starts from the first page; anything else would reach postgres
function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null

  const [parsedAt, id] = Buffer.from(value, 'base64url').toString().split('|')

  if (!parsedAt || !id || !uuidPattern.test(id)) return null

  const time = Date.parse(parsedAt)

  if (Number.isNaN(time)) return null

  return { parsedAt: new Date(time).toISOString(), id }
}
