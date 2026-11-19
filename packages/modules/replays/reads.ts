import type { MatchDetailContract, MyReplayContract } from '@brawltome/contracts'
import type { ObjectStore, Sql } from '@brawltome/foundation'
import { legendNamesOf } from '@brawltome/match-insights'
import { insightsOf, logInsightsFailure } from './insights'
import { replayKey } from './keys'
import { type MapPictures, mapKey } from './map-picture'
import { winningSlots } from './match-result'
import { findMatchRow, type StoredMatchRow } from './match-row'
import { summaryOf } from './match-summary'
import type { ReplaysDeps } from './model'
import { playbackPathOf } from './playback'

// what /v1 serves about matches and uploads; shapes come from @brawltome/contracts

type PlayerRow = Omit<MatchDetailContract['players'][number], 'isWinner' | 'legendKey'> & { matchId: string }

/** The game's own replay file names: `[11.00] BigCrystalTemple.replay`. */
export function replayFileName(patch: string, mapName: string): string {
  return `[${patch}] ${mapName.replace(/\s+/g, '')}.replay`
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

/** What reading a match needs: the art bucket's address is null when this process has no art bucket. */
export type MatchReadDeps = Pick<ReplaysDeps, 'database' | 'objectStore' | 'artStore'> & {
  artBaseUrl: string | null
  mapPictures: MapPictures
}

// a queued or failed export keeps the last good manifest, so its address is given whatever the state
function artOf(row: StoredMatchRow, artBaseUrl: string | null): MatchDetailContract['art'] {
  const manifestUrl = artBaseUrl && row.artManifestKey ? `${artBaseUrl}/${row.artManifestKey}` : null

  return { state: row.artState, manifestUrl, baseUrl: artBaseUrl }
}

// a match whose insights fail still has its page, without them
async function insightsOrNull(deps: MatchReadDeps, row: StoredMatchRow): Promise<MatchDetailContract['insights']> {
  try {
    return await insightsOf(deps, row)
  } catch (error) {
    logInsightsFailure(row.id, error)

    return null
  }
}

export async function getMatch(deps: MatchReadDeps, id: string): Promise<MatchDetailContract | null> {
  const sql = deps.database.sql
  const row = await findMatchRow(sql, id)

  if (!row) return null

  const players = await playersOf(sql, [row.id])
  const insights = await insightsOrNull(deps, row)
  // the page only plays back the matches it has insights for
  const playbackPath = insights ? playbackPathOf(row) : null

  const winners = winningSlots(players, row.hasTeams)
  const pictures = await deps.mapPictures([row])

  return {
    ...summaryOf(row, players, pictures.get(mapKey(row)) ?? null),
    hasTeamDamage: row.hasTeamDamage,
    isReliable: row.isReliable,
    failedChecks: row.failedChecks,
    players: players.map(({ matchId: _matchId, ...player }) => ({
      ...player,
      ...legendNamesOf({ id: player.legendId, name: player.legendName }),
      isWinner: winners.has(player.slot),
    })),
    replay: { available: !row.fileDeleted, patch: row.patch, fileName: replayFileName(row.patch, row.mapName) },
    insights,
    art: artOf(row, deps.artBaseUrl),
    playbackPath,
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
