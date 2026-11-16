import type { Sql } from '@brawltome/foundation'
import { findLiveArtJob } from './art-lease'
import { parseArtPath, verifyArtFile } from './art-paths'
import type { ReplaysDeps } from './model'

// the worker sends the art files the bucket lacks, one at a time. an upload first claims its path in art_files, so
// two attempts never write one path at once: the claim holds while the claiming attempt keeps its lease, and an
// attempt that lost its lease can be taken over. no transaction is held across the write to the bucket

export type StoreArtOutcome =
  | { status: 'stored' }
  // stored before; its name stands for its content or its inputs, so it is left as it is
  | { status: 'exists' }
  // another attempt that still holds its lease is uploading it
  | { status: 'in-progress' }
  | { status: 'rejected'; reason: string }
  | { status: 'lease-lost' }

type Uploader = { jobId: string; leaseToken: string }

/** Checks one file from the worker and puts it in the art bucket. */
export async function storeArtFile(
  deps: ReplaysDeps,
  jobId: string,
  leaseToken: string,
  path: string,
  bytes: Uint8Array,
): Promise<StoreArtOutcome> {
  if (!deps.artStore) throw new Error(`store art file ${path} for job ${jobId}: this process has no art bucket`)

  const problem = verifyArtFile(path, bytes)

  if (problem) return { status: 'rejected', reason: problem }

  const sql = deps.database.sql
  const job = await findLiveArtJob(sql, jobId, leaseToken)

  if (job === 'not-found' || job === 'lease-lost') return { status: 'lease-lost' }

  const uploader = { jobId, leaseToken }
  const isClaimed = await claimPath(sql, path, bytes.byteLength, uploader)

  if (!isClaimed) return heldOutcome(sql, path)

  await deps.artStore.put(path, bytes, parseArtPath(path)?.contentType as string)

  const isMarked = await markStored(sql, path, uploader)

  // this attempt's lease ran out during the upload, and another attempt took the path over
  if (!isMarked) return { status: 'lease-lost' }

  return { status: 'stored' }
}

// a path is claimed when it's new, when this attempt claimed it before (a retried upload), or when the attempt that
// claimed it no longer holds a live lease on its job
async function claimPath(sql: Sql, path: string, byteSize: number, uploader: Uploader): Promise<boolean> {
  const claimed = await sql`
    INSERT INTO replays.art_files (path, bytes, state, job_id, lease_token)
    VALUES (${path}, ${byteSize}, 'uploading', ${uploader.jobId}, ${uploader.leaseToken})
    ON CONFLICT (path) DO UPDATE SET bytes = excluded.bytes, job_id = excluded.job_id,
      lease_token = excluded.lease_token, created_at = clock_timestamp()
    WHERE art_files.state = 'uploading' AND (
      art_files.lease_token = excluded.lease_token
      OR NOT EXISTS (
        SELECT 1 FROM replays.art_jobs AS claimant
        WHERE claimant.id = art_files.job_id AND claimant.lease_token = art_files.lease_token
          AND claimant.status = 'processing' AND claimant.lease_expires_at > clock_timestamp()
      )
    )
  `

  return claimed.count === 1
}

async function heldOutcome(sql: Sql, path: string): Promise<StoreArtOutcome> {
  const [file] = await sql<{ state: string }[]>`SELECT state FROM replays.art_files WHERE path = ${path}`

  if (file?.state === 'stored') return { status: 'exists' }

  return { status: 'in-progress' }
}

async function markStored(sql: Sql, path: string, uploader: Uploader): Promise<boolean> {
  const marked = await sql`
    UPDATE replays.art_files SET state = 'stored', job_id = NULL, lease_token = NULL
    WHERE path = ${path} AND state = 'uploading' AND lease_token = ${uploader.leaseToken}
  `

  return marked.count === 1
}
