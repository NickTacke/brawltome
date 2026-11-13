import type { Sql, TransactionSql } from '@brawltome/foundation'
import type { ReplaysDeps } from './model'

export type WaitingUpload = { id: string; accountId: string; byOperator: boolean }

/** The uploads of a file still waiting for its match. */
export async function waitingUploads(sql: Sql | TransactionSql, digest: string): Promise<WaitingUpload[]> {
  return sql<WaitingUpload[]>`
    SELECT id, account_id AS "accountId", by_operator AS "byOperator"
    FROM replays.uploads WHERE digest = ${digest} AND status = 'queued'
  `
}

/** Uploads whose account's verified player played in the match, plus operators' uploads, which own any match. */
export async function owningUploads(
  deps: Pick<ReplaysDeps, 'accounts'>,
  uploads: WaitingUpload[],
  playerIds: readonly number[],
): Promise<Set<string>> {
  const owners = new Set<string>()

  for (const upload of uploads) {
    if (upload.byOperator) {
      owners.add(upload.id)
      continue
    }

    const { primaryPlayer } = await deps.accounts.getPrimaryPlayerVerificationState(upload.accountId)

    if (primaryPlayer && playerIds.includes(primaryPlayer.brawlhallaId)) owners.add(upload.id)
  }

  return owners
}

/** Links the owning uploads to the match and turns the others away, all inside the caller's transaction. */
export async function settleUploads(
  transaction: TransactionSql,
  uploads: WaitingUpload[],
  owners: Set<string>,
  matchId: string,
): Promise<void> {
  for (const upload of uploads) {
    if (owners.has(upload.id)) {
      await transaction`INSERT INTO replays.match_uploads (match_id, upload_id) VALUES (${matchId}, ${upload.id}) ON CONFLICT DO NOTHING`
      await transaction`UPDATE replays.uploads SET status = 'done' WHERE id = ${upload.id}`
      continue
    }

    await transaction`
      UPDATE replays.uploads SET status = 'rejected', rejection = ${JSON.stringify({ code: 'not-your-match' })}::text::jsonb
      WHERE id = ${upload.id}
    `
  }
}

/** Turns every upload of a file that is still waiting away with the job's failure code. */
export async function rejectWaitingUploads(sql: Sql | TransactionSql, digest: string, code: string): Promise<void> {
  await sql`
    UPDATE replays.uploads SET status = 'rejected', rejection = ${JSON.stringify({ code })}::text::jsonb
    WHERE digest = ${digest} AND status = 'queued'
  `
}
