import type { Sql } from '@brawltome/foundation'
import { replayKey } from './keys'
import { FILE_GRACE_DAYS } from './limits'
import type { ReplaysDeps } from './model'

// replay files live as long as their patch's game folder lives on the replay vm. the worker's claims say which
// patches it runs, and they start this cleanup; with no claims (the worker is down) nothing is ever deleted

// the newest patches by when the worker first ran them; their files are never deleted, whatever the dates say
const KEPT_PATCHES = 2

/** Records what the worker runs; a build never seen before queues a re-parse of every match whose file is kept. */
export async function noteWorkerReport(
  sql: Sql,
  report: { build: string; patches: string[] },
): Promise<{ isNewBuild: boolean }> {
  for (const patch of report.patches) {
    await sql`
      INSERT INTO replays.worker_reports (patch) VALUES (${patch})
      ON CONFLICT (patch) DO UPDATE SET last_reported_at = clock_timestamp()
    `
  }

  const inserted = await sql`INSERT INTO replays.builds (build) VALUES (${report.build}) ON CONFLICT DO NOTHING`

  if (inserted.count === 0) return { isNewBuild: false }

  await sql`
    INSERT INTO replays.jobs (digest, kind)
    SELECT match.digest, 'reparse'
    FROM replays.matches AS match
    JOIN replays.replay_files AS file ON file.digest = match.digest
    WHERE file.deleted_at IS NULL AND match.merged_into IS NULL AND match.build <> ${report.build}
    ON CONFLICT (digest) WHERE status IN ('pending', 'processing') DO NOTHING
  `

  return { isNewBuild: true }
}

/** Runs the file cleanup if it hasn't run in the last day; claims call this. */
export async function cleanupIfDue(deps: ReplaysDeps, now: Date): Promise<void> {
  const due = await deps.database.sql`
    UPDATE replays.maintenance SET last_run_at = ${now}
    WHERE name = 'file-cleanup' AND last_run_at <= ${now}::timestamptz - interval '1 day'
  `

  if (due.count === 1) await cleanupReplayFiles(deps, now)
}

/**
 * Deletes replay files whose patch the worker stopped running FILE_GRACE_DAYS ago, and files that never became a
 * match, once they are as old. Matches and their timelines stay. Returns how many files went.
 */
export async function cleanupReplayFiles(deps: ReplaysDeps, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - FILE_GRACE_DAYS * 24 * 60 * 60 * 1000)

  const expired = await deps.database.sql<{ digest: string }[]>`
    SELECT file.digest FROM replays.replay_files AS file
    WHERE file.deleted_at IS NULL
      AND (
        (file.patch IN (SELECT patch FROM replays.worker_reports WHERE last_reported_at < ${cutoff})
          AND file.patch NOT IN (SELECT patch FROM replays.worker_reports ORDER BY first_reported_at DESC LIMIT ${KEPT_PATCHES}))
        OR (file.created_at < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM replays.matches WHERE digest = file.digest)
          AND NOT EXISTS (SELECT 1 FROM replays.jobs WHERE digest = file.digest AND status IN ('pending', 'processing')))
      )
  `

  for (const { digest } of expired) {
    await deps.objectStore.delete(replayKey(digest))
    await deps.database.sql`UPDATE replays.replay_files SET deleted_at = ${now} WHERE digest = ${digest}`
  }

  return expired.length
}
