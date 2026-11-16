import type { Sql, TransactionSql } from '@brawltome/foundation'
import type { ReplaysDeps } from './model'

// art jobs wait here until the worker claims them. a match or patch has at most one waiting or running job, so
// queueing again while one is active does nothing; the active job reads the match's line when it is claimed

/** Queues an art export for a stored match and marks its art queued. */
export async function queueArtJob(deps: Pick<ReplaysDeps, 'database' | 'artStore'>, matchId: string): Promise<void> {
  if (!deps.artStore) return

  await queueMatchArt(deps.database.sql, matchId)
}

/** Queues the export of a patch's maps and default looks, ahead of its matches. */
export async function queueWarmJob(deps: Pick<ReplaysDeps, 'database' | 'artStore'>, patch: string): Promise<void> {
  if (!deps.artStore) return

  await queueWarmArt(deps.database.sql, patch)
}

export async function queueMatchArt(sql: Sql | TransactionSql, matchId: string): Promise<void> {
  await sql`
    WITH queued AS (
      INSERT INTO replays.art_jobs (kind, match_id, patch)
      SELECT 'match', id, patch FROM replays.matches WHERE id = ${matchId}
      ON CONFLICT (kind, (coalesce(match_id::text, patch))) WHERE status IN ('pending', 'processing') DO NOTHING
      RETURNING match_id
    )
    UPDATE replays.matches SET art_state = 'queued', art_failure = NULL WHERE id IN (SELECT match_id FROM queued)
  `
}

export async function queueWarmArt(sql: Sql, patch: string): Promise<void> {
  await sql`
    INSERT INTO replays.art_jobs (kind, patch) VALUES ('warm', ${patch})
    ON CONFLICT (kind, (coalesce(match_id::text, patch))) WHERE status IN ('pending', 'processing') DO NOTHING
  `
}

/** Queues a patch's warm job unless it ever had one, whatever became of it. */
export async function queueFirstWarmArt(sql: Sql, patch: string): Promise<void> {
  await sql`
    INSERT INTO replays.art_jobs (kind, patch)
    SELECT 'warm', ${patch}
    WHERE NOT EXISTS (SELECT 1 FROM replays.art_jobs WHERE kind = 'warm' AND patch = ${patch})
    ON CONFLICT (kind, (coalesce(match_id::text, patch))) WHERE status IN ('pending', 'processing') DO NOTHING
  `
}

/** Queues an art export for every match with a line whose art was drawn in another format, or never. */
export async function queueArtForFormat(sql: Sql, format: number): Promise<void> {
  await sql`
    WITH queued AS (
      INSERT INTO replays.art_jobs (kind, match_id, patch)
      SELECT 'match', id, patch FROM replays.matches
      WHERE art_format IS DISTINCT FROM ${format} AND timeline_key IS NOT NULL AND merged_into IS NULL
      ON CONFLICT (kind, (coalesce(match_id::text, patch))) WHERE status IN ('pending', 'processing') DO NOTHING
      RETURNING match_id
    )
    UPDATE replays.matches SET art_state = 'queued', art_failure = NULL WHERE id IN (SELECT match_id FROM queued)
  `
}
