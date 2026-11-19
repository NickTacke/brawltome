import type { MatchSummaryContract } from '@brawltome/contracts'
import type { Sql } from '@brawltome/foundation'
import { legendNamesOf } from '@brawltome/match-insights'
import { winningSlots } from './match-result'

// a match as a row of a list: what was played, who played and who won

export type SummaryRow = {
  id: string
  patch: string
  mapId: number
  mapName: string
  modeName: string
  queue: string | null
  isRanked: boolean
  isCustom: boolean
  hasTeams: boolean
  stocks: number | null
  durationMs: number
  parsedAt: Date
}

export type SummaryPlayer = {
  matchId: string
  slot: number
  brawlhallaId: number
  name: string
  team: number
  legendId: number
  legendName: string
  kos: number
  deaths: number
  damageDealt: number
  score: number | null
}

/** The players of these matches in slot order, as a list row needs them. */
export async function summaryPlayersOf(sql: Sql, matchIds: string[]): Promise<SummaryPlayer[]> {
  if (matchIds.length === 0) return []

  const rows = await sql<SummaryPlayer[]>`
    SELECT match_id AS "matchId", slot, brawlhalla_id AS "brawlhallaId", name, team, legend_id AS "legendId",
      legend_name AS "legendName", kos, deaths, damage_dealt AS "damageDealt", score
    FROM replays.match_players WHERE match_id IN ${sql(matchIds)}
    ORDER BY match_id, slot
  `

  // bigint arrives as a string from postgres.js
  return rows.map((row) => ({ ...row, brawlhallaId: Number(row.brawlhallaId) }))
}

export function summaryOf(
  row: SummaryRow,
  players: SummaryPlayer[],
  mapPictureUrl: string | null,
): MatchSummaryContract {
  const winners = winningSlots(players, row.hasTeams)

  return {
    id: row.id,
    patch: row.patch,
    mapName: row.mapName,
    modeName: row.modeName,
    isRanked: row.isRanked,
    isCustom: row.isCustom,
    queue: row.queue,
    hasTeams: row.hasTeams,
    stocks: row.stocks,
    durationMs: row.durationMs,
    parsedAt: row.parsedAt.toISOString(),
    mapPictureUrl,
    players: players.map((player) => ({
      slot: player.slot,
      brawlhallaId: player.brawlhallaId,
      name: player.name,
      team: player.team,
      legendId: player.legendId,
      ...legendNamesOf({ id: player.legendId, name: player.legendName }),
      kos: player.kos,
      deaths: player.deaths,
      damageDealt: player.damageDealt,
      score: player.score,
      isWinner: winners.has(player.slot),
    })),
  }
}
