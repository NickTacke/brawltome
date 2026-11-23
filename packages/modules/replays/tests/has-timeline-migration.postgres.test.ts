import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createReplays } from '../migrations/0001-create-replays'
import { addWorkerReports } from '../migrations/0002-add-worker-reports'
import { addArt } from '../migrations/0003-add-art'
import { allowNoScore } from '../migrations/0004-allow-no-score'
import { indexRecentMatches } from '../migrations/0005-index-recent-matches'
import { addHasTimeline } from '../migrations/0006-add-has-timeline'

const connectionString = process.env.DATABASE_URL
const earlierMigrations = [createReplays, addWorkerReports, addArt, allowNoScore, indexRecentMatches]

type ArtRow = { state: string; failure: unknown; hasTimeline: boolean }
type SeededMatch = { isCustom: boolean; state: string; failure: object | null; manifestKey?: string }

const noAnimations = { code: 'no-animations', message: 'the line has no timeline.animations' }

// starts with replays up to 0005, seeds matches the way production had them, then applies 0006
describe.skipIf(!connectionString)('replays 0006 has_timeline migration', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase({ label: 'replays_has_timeline', modules: [...accountsTestModules] })

    for (const migration of earlierMigrations) await database.sql.unsafe(migration.sql)
  }, 20_000)

  afterAll(async () => {
    await database?.drop()
  }, 20_000)

  async function insertMatch(digit: string, seeded: SeededMatch) {
    const digest = `sha256:${digit.repeat(64)}`

    await database.sql`INSERT INTO replays.replay_files (digest, byte_size) VALUES (${digest}, 64)`

    const [match] = await database.sql<{ id: string }[]>`
      INSERT INTO replays.matches (digest, candidate_key, patch, format, build, map_id, map_name, mode_name,
        is_ranked, is_custom, has_teams, has_team_damage, duration_ms, is_reliable, failed_checks, unchecked,
        timeline_key, art_state, art_failure, art_manifest_key)
      VALUES (${digest}, 'key', '11.00', 1, 'dev-1', 136, 'Big Crystal Temple', 'Stock', ${!seeded.isCustom},
        ${seeded.isCustom}, false, false, 180000, true, '[]', '[]', 'timeline', ${seeded.state},
        ${seeded.failure ? JSON.stringify(seeded.failure) : null}::text::jsonb, ${seeded.manifestKey ?? null})
      RETURNING id
    `

    return match?.id as string
  }

  async function artOf(matchId: string): Promise<ArtRow | undefined> {
    const [row] = await database.sql<ArtRow[]>`
      SELECT art_state AS state, art_failure AS failure, has_timeline AS "hasTimeline"
      FROM replays.matches WHERE id = ${matchId}
    `

    return row
  }

  test('clears the no-animations failures of custom matches and keeps every other match', async () => {
    const custom = await insertMatch('a', { isCustom: true, state: 'failed', failure: noAnimations })
    const ranked = await insertMatch('b', { isCustom: false, state: 'failed', failure: noAnimations })

    const exportFailed = await insertMatch('c', {
      isCustom: true,
      state: 'failed',
      failure: { code: 'export-failed', message: 'swf missing' },
    })

    const ready = await insertMatch('d', { isCustom: false, state: 'ready', failure: null, manifestKey: 'manifest' })

    await database.sql.unsafe(addHasTimeline.sql)

    expect(await artOf(custom)).toEqual({ state: 'none', failure: null, hasTimeline: false })
    expect(await artOf(ranked)).toEqual({ state: 'failed', failure: noAnimations, hasTimeline: true })

    expect(await artOf(exportFailed)).toEqual({
      state: 'failed',
      failure: { code: 'export-failed', message: 'swf missing' },
      hasTimeline: true,
    })

    expect(await artOf(ready)).toEqual({ state: 'ready', failure: null, hasTimeline: true })
  })
})
