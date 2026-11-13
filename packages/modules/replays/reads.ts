import type { MatchDetailContract, MatchSummaryContract, MyReplayContract } from '@brawltome/contracts'
import type { ObjectStore, Sql } from '@brawltome/foundation'
import { replayKey } from './keys'

// what /v1 serves about matches and uploads; shapes come from @brawltome/contracts

type MatchRow = {
  id: string
  mergedInto: string | null
  digest: string
  patch: string
  mapName: string
  modeName: string
  queue: string | null
  isRanked: boolean
  isCustom: boolean
  hasTeams: boolean
  hasTeamDamage: boolean
  stocks: number | null
  durationMs: number
  isReliable: boolean
  failedChecks: string[]
  parsedAt: Date
  fileDeleted: boolean
}

type PlayerRow = MatchDetailContract['players'][number] & { matchId: string }

// a merged match keeps answering under its old id
const MAX_MERGE_HOPS = 3

/** The game's own replay file names: `[11.00] BigCrystalTemple.replay`. */
export function replayFileName(patch: string, mapName: string): string {
  return `[${patch}] ${mapName.replace(/\s+/g, '')}.replay`
}

async function findMatchRow(sql: Sql, id: string): Promise<MatchRow | null> {
  let currentId = id

  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
    const [row] = await sql<MatchRow[]>`
      SELECT match.id, match.merged_into AS "mergedInto", match.digest, match.patch, match.map_name AS "mapName",
        match.mode_name AS "modeName", match.queue, match.is_ranked AS "isRanked", match.is_custom AS "isCustom",
        match.has_teams AS "hasTeams", match.has_team_damage AS "hasTeamDamage", match.stocks,
        match.duration_ms AS "durationMs", match.is_reliable AS "isReliable", match.failed_checks AS "failedChecks",
        match.parsed_at AS "parsedAt", file.deleted_at IS NOT NULL AS "fileDeleted"
      FROM replays.matches AS match
      JOIN replays.replay_files AS file ON file.digest = match.digest
      WHERE match.id = ${currentId}
    `

    if (!row?.mergedInto) return row ?? null

    currentId = row.mergedInto
  }

  return null
}

async function playersOf(sql: Sql, matchIds: string[]): Promise<PlayerRow[]> {
  if (matchIds.length === 0) return []

  const rows = await sql<PlayerRow[]>`
    SELECT match_id AS "matchId", slot, brawlhalla_id AS "brawlhallaId", name, team, legend_id AS "legendId",
      legend_name AS "legendName", damage_dealt AS "damageDealt", damage_taken AS "damageTaken", kos, deaths,
      suicides, team_kos AS "teamKos", clashes, dodges, air_dodges AS "airDodges", jumps, air_jumps AS "airJumps",
      dashes, dash_jumps AS "dashJumps", time_in_air_ms AS "timeInAirMs", time_on_ground_ms AS "timeOnGroundMs",
      time_on_wall_ms AS "timeOnWallMs", score, weapons
    FROM replays.match_players WHERE match_id IN ${sql(matchIds)}
    ORDER BY match_id, slot
  `

  // bigint arrives as a string from postgres.js
  return rows.map((row) => ({ ...row, brawlhallaId: Number(row.brawlhallaId) }))
}

function summaryOf(row: MatchRow, players: PlayerRow[]): MatchSummaryContract {
  return {
    id: row.id,
    patch: row.patch,
    mapName: row.mapName,
    modeName: row.modeName,
    isRanked: row.isRanked,
    isCustom: row.isCustom,
    durationMs: row.durationMs,
    parsedAt: row.parsedAt.toISOString(),
    players: players.map(({ slot, brawlhallaId, name, team, legendId, legendName }) => ({
      slot,
      brawlhallaId,
      name,
      team,
      legendId,
      legendName,
    })),
  }
}

export async function getMatch(sql: Sql, id: string): Promise<MatchDetailContract | null> {
  const row = await findMatchRow(sql, id)

  if (!row) return null

  const players = await playersOf(sql, [row.id])

  return {
    ...summaryOf(row, players),
    queue: row.queue,
    hasTeams: row.hasTeams,
    hasTeamDamage: row.hasTeamDamage,
    stocks: row.stocks,
    isReliable: row.isReliable,
    failedChecks: row.failedChecks,
    players: players.map(({ matchId: _matchId, ...player }) => player),
    replay: { available: !row.fileDeleted, patch: row.patch, fileName: replayFileName(row.patch, row.mapName) },
  }
}

type Cursor = { parsedAt: string; id: string }

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.parsedAt}|${cursor.id}`).toString('base64url')
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null

  const [parsedAt, id] = Buffer.from(value, 'base64url').toString().split('|')

  if (!parsedAt || !id || Number.isNaN(Date.parse(parsedAt)) || !/^[0-9a-f-]{36}$/.test(id)) return null

  return { parsedAt, id }
}

/** A player's matches, newest first; the cursor continues where the previous page stopped. */
export async function listPlayerMatches(
  sql: Sql,
  brawlhallaId: number,
  cursorValue: string | undefined,
  limit = 20,
): Promise<{ matches: MatchSummaryContract[]; nextCursor: string | null }> {
  const cursor = decodeCursor(cursorValue)

  const rows = await sql<MatchRow[]>`
    SELECT match.id, match.merged_into AS "mergedInto", match.digest, match.patch, match.map_name AS "mapName",
      match.mode_name AS "modeName", match.queue, match.is_ranked AS "isRanked", match.is_custom AS "isCustom",
      match.has_teams AS "hasTeams", match.has_team_damage AS "hasTeamDamage", match.stocks,
      match.duration_ms AS "durationMs", match.is_reliable AS "isReliable", match.failed_checks AS "failedChecks",
      match.parsed_at AS "parsedAt", false AS "fileDeleted"
    FROM replays.matches AS match
    WHERE match.merged_into IS NULL
      AND EXISTS (SELECT 1 FROM replays.match_players AS player
                  WHERE player.match_id = match.id AND player.brawlhalla_id = ${brawlhallaId})
      ${cursor ? sql`AND (match.parsed_at, match.id) < (${cursor.parsedAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
    ORDER BY match.parsed_at DESC, match.id DESC
    LIMIT ${limit + 1}
  `

  const page = rows.slice(0, limit)

  const players = await playersOf(
    sql,
    page.map((row) => row.id),
  )

  const last = page.at(-1)

  return {
    matches: page.map((row) =>
      summaryOf(
        row,
        players.filter((player) => player.matchId === row.id),
      ),
    ),
    nextCursor:
      rows.length > limit && last ? encodeCursor({ parsedAt: last.parsedAt.toISOString(), id: last.id }) : null,
  }
}

/** The visitor's own uploads, newest first, with where each one stands. */
export async function listMyReplays(sql: Sql, accountId: string, limit = 50): Promise<MyReplayContract[]> {
  const rows = await sql<
    {
      uploadId: string
      fileName: string | null
      status: string
      code: string | null
      matchId: string | null
      parsing: boolean
      createdAt: Date
    }[]
  >`
    SELECT upload.id AS "uploadId", upload.file_name AS "fileName", upload.status,
      upload.rejection->>'code' AS code, link.match_id AS "matchId", upload.created_at AS "createdAt",
      EXISTS (SELECT 1 FROM replays.jobs AS job WHERE job.digest = upload.digest AND job.status = 'processing') AS parsing
    FROM replays.uploads AS upload
    LEFT JOIN replays.match_uploads AS link ON link.upload_id = upload.id
    WHERE upload.account_id = ${accountId}
    ORDER BY upload.created_at DESC, upload.id DESC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    uploadId: row.uploadId,
    fileName: row.fileName,
    status: myStatus(row.status, row.parsing),
    rejection: (row.code as MyReplayContract['rejection']) ?? null,
    matchId: row.matchId,
    createdAt: row.createdAt.toISOString(),
  }))
}

function myStatus(status: string, parsing: boolean): MyReplayContract['status'] {
  if (status === 'done') return 'done'

  if (status === 'rejected') return 'rejected'

  return parsing ? 'parsing' : 'waiting'
}

/** The replay file of a match while it's still kept; 'gone' after its patch expired. */
export async function getReplayFile(
  deps: { database: { sql: Sql }; objectStore: ObjectStore },
  matchId: string,
): Promise<{ bytes: Uint8Array; fileName: string } | 'gone' | null> {
  const row = await findMatchRow(deps.database.sql, matchId)

  if (!row) return null

  if (row.fileDeleted) return 'gone'

  const bytes = await deps.objectStore.get(replayKey(row.digest))

  if (!bytes) return 'gone'

  return { bytes, fileName: replayFileName(row.patch, row.mapName) }
}
