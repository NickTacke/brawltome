import type { Sql } from '@brawltome/foundation'
import { MAX_MERGE_HOPS } from './limits'

// one stored match as the reads use it, found through the matches merged into another

export type MatchRow = {
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

export type ArtState = 'none' | 'queued' | 'ready' | 'failed'

/** A match with where its line and art are kept, for the match page. */
export type StoredMatchRow = MatchRow & {
  build: string
  mapId: number
  timelineKey: string | null
  artState: ArtState
  artManifestKey: string | null
}

/** The match with this id, or the one it was merged into; null when there is none. */
export async function findMatchRow(sql: Sql, id: string): Promise<StoredMatchRow | null> {
  let currentId = id

  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
    const [row] = await sql<StoredMatchRow[]>`
      SELECT match.id, match.merged_into AS "mergedInto", match.digest, match.patch, match.map_name AS "mapName",
        match.mode_name AS "modeName", match.queue, match.is_ranked AS "isRanked", match.is_custom AS "isCustom",
        match.has_teams AS "hasTeams", match.has_team_damage AS "hasTeamDamage", match.stocks,
        match.duration_ms AS "durationMs", match.is_reliable AS "isReliable", match.failed_checks AS "failedChecks",
        match.parsed_at AS "parsedAt", file.deleted_at IS NOT NULL AS "fileDeleted", match.build,
        match.map_id AS "mapId", match.timeline_key AS "timelineKey", match.art_state AS "artState",
        match.art_manifest_key AS "artManifestKey"
      FROM replays.matches AS match
      JOIN replays.replay_files AS file ON file.digest = match.digest
      WHERE match.id = ${currentId}
    `

    if (!row?.mergedInto) return row ?? null

    currentId = row.mergedInto
  }

  return null
}
