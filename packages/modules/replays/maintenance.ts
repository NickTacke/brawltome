import type { Sql } from '@brawltome/foundation'
import { queueArtForFormat, queueFirstWarmArt } from './art-queue'
import { replayKey } from './keys'
import { FILE_GRACE_DAYS } from './limits'
import type { ReplaysDeps, WorkerReport } from './model'
import { comparePatchesNewestFirst } from './patches'

// replay files live as long as their patch's game folder lives on the replay vm. the worker's claims say which
// patches it runs, and they start this cleanup; with no claims (the worker is down) nothing is ever deleted

// the newest patches by version, the ones the worker's game folders most likely still hold; their files are never
// deleted, whatever the dates say
const KEPT_PATCHES = 2

/**
 * Records what the worker runs. A build never seen before queues a re-parse of every match whose file is kept; with
 * an art bucket, a patch never warmed queues its warm job and a new art format re-exports the matches drawn in
 * another.
 */
export async function noteWorkerReport(
  deps: Pick<ReplaysDeps, 'database' | 'artStore'>,
  report: WorkerReport,
): Promise<{ isNewBuild: boolean }> {
  const sql = deps.database.sql

  for (const patch of report.patches) await notePatch(sql, patch)

  if (deps.artStore) {
    // decided from the art jobs, not from worker_reports, which holds patches reported before there was art
    for (const patch of report.patches) await queueFirstWarmArt(sql, patch)

    if (report.artFormat !== null) await noteArtFormat(sql, report.artFormat)
  }

  return noteBuild(sql, report.build)
}

async function notePatch(sql: Sql, patch: string): Promise<void> {
  await sql`
    INSERT INTO replays.worker_reports (patch) VALUES (${patch})
    ON CONFLICT (patch) DO UPDATE SET last_reported_at = clock_timestamp()
  `
}

async function noteArtFormat(sql: Sql, format: number): Promise<void> {
  const inserted = await sql`INSERT INTO replays.art_formats (format) VALUES (${format}) ON CONFLICT DO NOTHING`

  if (inserted.count === 1) await queueArtForFormat(sql, format)
}

async function noteBuild(sql: Sql, build: string): Promise<{ isNewBuild: boolean }> {
  const inserted = await sql`INSERT INTO replays.builds (build) VALUES (${build}) ON CONFLICT DO NOTHING`

  if (inserted.count === 0) return { isNewBuild: false }

  await sql`
    INSERT INTO replays.jobs (digest, kind)
    SELECT match.digest, 'reparse'
    FROM replays.matches AS match
    JOIN replays.replay_files AS file ON file.digest = match.digest
    WHERE file.deleted_at IS NULL AND match.merged_into IS NULL AND match.build <> ${build}
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
  const keptPatches = await newestPatches(deps.database.sql)

  const expired = await deps.database.sql<{ digest: string }[]>`
    SELECT file.digest FROM replays.replay_files AS file
    WHERE file.deleted_at IS NULL
      AND (
        (file.patch IN (SELECT patch FROM replays.worker_reports WHERE last_reported_at < ${cutoff})
          AND NOT file.patch = ANY(${keptPatches}::text[]))
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

async function newestPatches(sql: Sql): Promise<string[]> {
  const reports = await sql<{ patch: string }[]>`SELECT patch FROM replays.worker_reports`
  const patches = reports.map((report) => report.patch).sort(comparePatchesNewestFirst)

  return patches.slice(0, KEPT_PATCHES)
}

export type ReplayQueueInspection = {
  jobsByStatus: Record<'pending' | 'processing' | 'completed' | 'failed', number>
  // 0 when nothing waits
  oldestPendingAgeMs: number
}

/** What /metrics reports about the replay queue. */
export async function inspectReplayQueue(sql: Sql): Promise<ReplayQueueInspection> {
  const counts = await sql<{ status: keyof ReplayQueueInspection['jobsByStatus']; count: number }[]>`
    SELECT status, count(*)::int AS count FROM replays.jobs GROUP BY status
  `

  const [oldest] = await sql<{ ageMs: number | null }[]>`
    SELECT (extract(epoch FROM clock_timestamp() - min(created_at)) * 1000)::bigint AS "ageMs"
    -- re-parses after a new build may wait for hours by design; only uploads waiting to be read count
    FROM replays.jobs WHERE status = 'pending' AND kind = 'parse'
  `

  const jobsByStatus = { pending: 0, processing: 0, completed: 0, failed: 0 }

  for (const { status, count } of counts) jobsByStatus[status] = count

  return { jobsByStatus, oldestPendingAgeMs: Number(oldest?.ageMs ?? 0) }
}
