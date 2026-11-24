import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createReplays } from '../migrations/0001-create-replays'
import { addWorkerReports } from '../migrations/0002-add-worker-reports'
import { addArt } from '../migrations/0003-add-art'
import { allowNoScore } from '../migrations/0004-allow-no-score'
import { indexRecentMatches } from '../migrations/0005-index-recent-matches'
import { addHasTimeline } from '../migrations/0006-add-has-timeline'
import { addSetIndexes } from '../migrations/0007-add-set-indexes'

const connectionString = process.env.DATABASE_URL
const earlierMigrations = [createReplays, addWorkerReports, addArt, allowNoScore, indexRecentMatches, addHasTimeline]

type JobRow = {
  kind: string
  matchId: string | null
  patch: string
  status: string
  attempts: number
  leaseToken: string | null
  failure: unknown
}

const statuses = ['pending', 'processing', 'completed', 'failed'] as const

// starts with replays up to 0006, seeds match and warm jobs of every status the way production has them, then applies
// 0007, which drops and adds back the kind check over those rows
describe.skipIf(!connectionString)('replays 0007 set indexes migration', () => {
  let database: TestDatabase
  let jobsBefore: JobRow[]

  beforeAll(async () => {
    database = await createTestDatabase({ label: 'replays_set_indexes', modules: [...accountsTestModules] })

    for (const migration of earlierMigrations) await database.sql.unsafe(migration.sql)

    for (const [position, status] of statuses.entries()) {
      const matchId = await insertMatch(String(position + 1))

      await insertJob({ kind: 'match', matchId, patch: '11.00', status })
      await insertJob({ kind: 'warm', matchId: null, patch: `11.0${position}`, status })
    }

    jobsBefore = await jobs()

    await database.sql.unsafe(addSetIndexes.sql)
  }, 20_000)

  afterAll(async () => {
    await database?.drop()
  }, 20_000)

  async function insertMatch(digit: string): Promise<string> {
    const digest = `sha256:${digit.repeat(64)}`

    await database.sql`INSERT INTO replays.replay_files (digest, byte_size) VALUES (${digest}, 64)`

    const [match] = await database.sql<{ id: string }[]>`
      INSERT INTO replays.matches (digest, candidate_key, patch, format, build, map_id, map_name, mode_name,
        is_ranked, is_custom, has_teams, has_team_damage, duration_ms, is_reliable, failed_checks, unchecked,
        timeline_key, art_state)
      VALUES (${digest}, 'key', '11.00', 1, 'dev-1', 136, 'Big Crystal Temple', 'Stock', true, false, false, false,
        180000, true, '[]', '[]', 'timeline', 'queued')
      RETURNING id
    `

    return match?.id as string
  }

  // a job as the worker leaves it in each status: leased while processing, with a failure once failed
  async function insertJob(job: { kind: string; matchId: string | null; patch: string; status: string }) {
    const isProcessing = job.status === 'processing'
    const failure = job.status === 'failed' ? JSON.stringify({ code: 'export-failed', message: 'boom' }) : null

    await database.sql`
      INSERT INTO replays.art_jobs (kind, match_id, patch, status, attempts, lease_token, lease_expires_at, failure)
      VALUES (${job.kind}, ${job.matchId}, ${job.patch}, ${job.status}, ${job.status === 'pending' ? 0 : 1},
        ${isProcessing ? 'b1c2d3e4-0a51-4f6c-9a43-5d1e2f3a4b5c' : null},
        ${isProcessing ? new Date(Date.now() + 60_000) : null}, ${failure}::text::jsonb)
    `
  }

  async function jobs(): Promise<JobRow[]> {
    const rows = await database.sql<JobRow[]>`
      SELECT kind, match_id AS "matchId", patch, status, attempts, lease_token AS "leaseToken", failure
      FROM replays.art_jobs ORDER BY kind, patch, status
    `

    return [...rows]
  }

  test('keeps every match and warm job as it was, none of them waiting', async () => {
    expect(jobsBefore).toHaveLength(8)
    expect(await jobs()).toEqual(jobsBefore)

    const waiting = await database.sql`SELECT id FROM replays.art_jobs WHERE wait_until IS NOT NULL`

    expect(waiting).toHaveLength(0)
  })

  test('allows a predraw job, and still refuses a kind it does not know', async () => {
    await database.sql`INSERT INTO replays.art_jobs (kind, patch) VALUES ('predraw', '11.00')`

    const insertUnknown = database.sql`INSERT INTO replays.art_jobs (kind, patch) VALUES ('repaint', '11.00')`

    await expect(insertUnknown).rejects.toThrow('art_jobs_kind_check')

    const [predraw] = await database.sql`SELECT status FROM replays.art_jobs WHERE kind = 'predraw'`

    expect(predraw).toEqual({ status: 'pending' })
  })

  test('adds an empty set index table that keeps each index with its set format', async () => {
    expect(await database.sql`SELECT * FROM replays.set_indexes`).toHaveLength(0)

    await database.sql`
      INSERT INTO replays.set_indexes (patch, path, format) VALUES ('11.00', ${`sets/${'a'.repeat(32)}.json`}, 4)
    `

    const withoutFormat = database.sql`
      INSERT INTO replays.set_indexes (patch, path) VALUES ('11.01', ${`sets/${'b'.repeat(32)}.json`})
    `

    await expect(withoutFormat).rejects.toThrow('format')
  })
})
