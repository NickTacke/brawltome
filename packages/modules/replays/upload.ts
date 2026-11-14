import { createHash } from 'node:crypto'
import type { Sql, TransactionSql } from '@brawltome/foundation'
import { replayKey } from './keys'
import { MAX_PENDING_PER_ACCOUNT, MAX_REPLAY_BYTES, MAX_UPLOADS_PER_DAY } from './limits'
import type { ReplaysDeps } from './model'
import { owningUploads, settleUploads, waitingUploads } from './ownership'

// a File fits; its size is checked before it's read, so an oversized file never lands in memory twice
export type UploadFile = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

type ReadFile = { name: string; bytes: Uint8Array }

export type UploadRejectionCode = 'too-large' | 'not-a-replay' | 'too-many-pending' | 'daily-limit' | 'not-your-match'

export type UploadOutcome = {
  uploadId: string | null
  fileName: string
  status: 'queued' | 'done' | 'rejected'
  matchId: string | null
  rejection: UploadRejectionCode | null
}

type UploadDeps = ReplaysDeps

type UploadInput = { accountId: string; isOperator: boolean; files: UploadFile[] }

/** Stores each file once and queues one parse job per distinct file; one outcome per file, in order. */
export async function uploadReplays(deps: UploadDeps, input: UploadInput): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = []

  // one at a time, so each file's limit check sees the files before it
  for (const file of input.files) outcomes.push(await uploadOne(deps, input, file))

  return outcomes
}

async function uploadOne(deps: UploadDeps, input: UploadInput, upload: UploadFile): Promise<UploadOutcome> {
  if (upload.size > MAX_REPLAY_BYTES) return rejected(upload.name, 'too-large')

  const file: ReadFile = { name: upload.name, bytes: new Uint8Array(await upload.arrayBuffer()) }
  const rejection = checkFile(file.bytes)

  if (rejection) return rejected(file.name, rejection)

  const digest = `sha256:${createHash('sha256').update(file.bytes).digest('hex')}`
  const existing = await findUpload(deps.database.sql, input.accountId, digest)

  if (existing) return { ...existing, fileName: file.name }

  // checked here too, so a refused file never reaches the bucket; recordUpload checks again under the lock
  const limit = await checkLimits(deps.database.sql, input.accountId)

  if (limit) return rejected(file.name, limit)

  await storeFile(deps, digest, file.bytes)

  const recordLimit = await recordUpload(deps.database.sql, input, file, digest)

  if (recordLimit) return rejected(file.name, recordLimit)

  await joinExistingMatch(deps, digest)

  const recorded = await findUpload(deps.database.sql, input.accountId, digest)

  return { ...(recorded as Omit<UploadOutcome, 'fileName'>), fileName: file.name }
}

// a file that was already parsed needs no job: its new uploader joins the match if they played in it
async function joinExistingMatch(deps: UploadDeps, digest: string): Promise<void> {
  const [match] = await deps.database.sql<{ id: string }[]>`SELECT id FROM replays.matches WHERE digest = ${digest}`

  if (!match) return

  const players = await deps.database.sql<{ brawlhallaId: number }[]>`
    SELECT brawlhalla_id AS "brawlhallaId" FROM replays.match_players WHERE match_id = ${match.id}
  `

  const uploads = await waitingUploads(deps.database.sql, digest)

  const owners = await owningUploads(
    deps,
    uploads,
    players.map((player) => Number(player.brawlhallaId)),
  )

  await deps.database.sql.begin((transaction) => settleUploads(transaction, uploads, owners, match.id))
}

// a replay is a zlib stream; checking its header keeps obvious junk out of the bucket
function checkFile(bytes: Uint8Array): UploadRejectionCode | null {
  if (bytes.byteLength > MAX_REPLAY_BYTES) return 'too-large'

  if (bytes.byteLength < 2 || bytes[0] !== 0x78 || bytes[1] !== 0xda) return 'not-a-replay'

  return null
}

function rejected(fileName: string, rejection: UploadRejectionCode): UploadOutcome {
  return { uploadId: null, fileName, status: 'rejected', matchId: null, rejection }
}

async function findUpload(
  sql: Sql | TransactionSql,
  accountId: string,
  digest: string,
): Promise<Omit<UploadOutcome, 'fileName'> | null> {
  const [row] = await sql<
    { id: string; status: UploadOutcome['status']; matchId: string | null; code: string | null }[]
  >`
    SELECT upload.id, upload.status, link.match_id AS "matchId", upload.rejection->>'code' AS code
    FROM replays.uploads AS upload
    LEFT JOIN replays.match_uploads AS link ON link.upload_id = upload.id
    WHERE upload.account_id = ${accountId} AND upload.digest = ${digest}
  `

  if (!row) return null

  return {
    uploadId: row.id,
    status: row.status,
    matchId: row.matchId,
    rejection: row.code as UploadRejectionCode | null,
  }
}

async function checkLimits(sql: Sql | TransactionSql, accountId: string): Promise<UploadRejectionCode | null> {
  const [counts] = await sql<{ pending: number; today: number }[]>`
    SELECT
      (SELECT count(*)::int FROM replays.uploads AS upload
        WHERE upload.account_id = ${accountId} AND upload.status = 'queued') AS pending,
      (SELECT count(*)::int FROM replays.uploads
        WHERE account_id = ${accountId}
          AND created_at >= date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today
  `

  if ((counts?.pending ?? 0) >= MAX_PENDING_PER_ACCOUNT) return 'too-many-pending'

  if ((counts?.today ?? 0) >= MAX_UPLOADS_PER_DAY) return 'daily-limit'

  return null
}

// the file goes to the bucket before its row exists, so a row always has its file; a file without a row is
// harmless and the next upload of the same bytes reuses it
async function storeFile(deps: UploadDeps, digest: string, bytes: Uint8Array): Promise<void> {
  const [file] = await deps.database.sql<{ deleted: boolean }[]>`
    SELECT deleted_at IS NOT NULL AS deleted FROM replays.replay_files WHERE digest = ${digest}
  `

  if (file && !file.deleted) return

  await deps.objectStore.put(replayKey(digest), bytes, 'application/octet-stream')
}

// one account's uploads are recorded one at a time, so two requests at once can't both pass the limits or both
// insert the same file; a file already recorded by the other request is simply kept
async function recordUpload(
  sql: Sql,
  input: UploadInput,
  file: ReadFile,
  digest: string,
): Promise<UploadRejectionCode | null> {
  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`replay-uploads:${input.accountId}`}, 0))`

    if (await findUpload(transaction, input.accountId, digest)) return null

    const limit = await checkLimits(transaction, input.accountId)

    if (limit) return limit

    await transaction`
      INSERT INTO replays.replay_files (digest, byte_size) VALUES (${digest}, ${file.bytes.byteLength})
      ON CONFLICT (digest) DO UPDATE SET deleted_at = NULL
    `

    await transaction`
      INSERT INTO replays.uploads (account_id, digest, byte_size, file_name, by_operator)
      VALUES (${input.accountId}, ${digest}, ${file.bytes.byteLength}, ${file.name.slice(0, 255)}, ${input.isOperator})
    `

    // a file that already has a match or an active job doesn't need another parse
    await transaction`
      INSERT INTO replays.jobs (digest, kind)
      SELECT ${digest}, 'parse'
      WHERE NOT EXISTS (SELECT 1 FROM replays.matches WHERE digest = ${digest})
      ON CONFLICT (digest) WHERE status IN ('pending', 'processing') DO NOTHING
    `

    return null
  })
}
