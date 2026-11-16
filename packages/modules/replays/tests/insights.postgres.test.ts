import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { replaysModule } from '../index'
import { readMatchInsightsFor } from '../insights'
import { claimJob, completeJob } from '../jobs'
import type { ReplaysDeps } from '../model'
import { getMatch } from '../reads'
import { uploadReplays } from '../upload'
import { fakeLayout } from './fixtures/art'
import { brokenLine, insightLine, timedLine } from './fixtures/insight-lines'
import { fakeReplay } from './fixtures/replays'

const connectionString = process.env.DATABASE_URL
const artBaseUrl = 'https://art.brawltome.app'
const mapPath = `maps/${'4'.repeat(32)}.json`

// a map file as the art export writes it; the insights read its layout
const mapFile = { format: 3, mapId: 135, patch: '11.00', background: null, layout: fakeLayout }

type MemoryStore = ReturnType<typeof createMemoryObjectStore>

describe.skipIf(!connectionString)('match insights', () => {
  let database: TestDatabase
  let deps: ReplaysDeps & { objectStore: MemoryStore; artStore: MemoryStore }

  beforeAll(async () => {
    database = await createTestDatabase({ label: 'replays_insights', modules: [...accountsTestModules, replaysModule] })
  }, 20_000)

  afterAll(async () => {
    await database?.drop()
  }, 20_000)

  beforeEach(async () => {
    await database.sql`
      TRUNCATE replays.art_jobs, replays.art_files, replays.map_files, replays.art_formats, replays.jobs,
        replays.match_uploads, replays.match_players, replays.matches, replays.uploads, replays.replay_files,
        replays.worker_reports, replays.builds
    `

    // the worker already ran 11.00 and dev-1, so claims queue no warm job or re-parse
    await database.sql`INSERT INTO replays.worker_reports (patch) VALUES ('11.00')`
    await database.sql`INSERT INTO replays.builds (build) VALUES ('dev-1')`
    await database.sql`INSERT INTO replays.art_jobs (kind, patch, status) VALUES ('warm', '11.00', 'completed')`

    deps = {
      database,
      objectStore: createMemoryObjectStore(),
      artStore: createMemoryObjectStore(),
      accounts: {} as Accounts,
    }
  })

  // an operator's upload, parsed by the worker into a stored match
  async function storedMatch(line = insightLine()): Promise<string> {
    const accountId = randomUUID()

    await database.sql`INSERT INTO accounts.users (id) VALUES (${accountId})`

    const files = [new File([new Uint8Array(fakeReplay().bytes)], 'a.replay')]
    const [upload] = await uploadReplays(deps, { accountId, isOperator: true, files })
    const claimed = await claimJob(deps, { build: 'dev-1', patches: ['11.00'], artFormat: null })

    const outcome = await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line,
    })

    expect(outcome).toBe('completed')

    const [match] = await database.sql<{ id: string }[]>`
      SELECT match_id AS id FROM replays.match_uploads WHERE upload_id = ${upload?.uploadId as string}
    `

    return match?.id as string
  }

  function insightKeys(matchId: string): string[] {
    return deps.objectStore.keys().filter((key) => key.startsWith(`insights/${matchId}/`))
  }

  async function addMapFile(): Promise<void> {
    await database.sql`INSERT INTO replays.map_files (patch, map_id, path) VALUES ('11.00', 135, ${mapPath})`
    await deps.artStore.put(mapPath, new TextEncoder().encode(JSON.stringify(mapFile)), 'application/json')
  }

  test('a stored match gets its insights, kept under the version and no layout', async () => {
    const matchId = await storedMatch()

    expect(insightKeys(matchId)).toEqual([`insights/${matchId}/dev-1/1-none.json.gz`])
  })

  test('a first read stores the insights and a second read reuses them', async () => {
    const matchId = await storedMatch()
    const key = `insights/${matchId}/dev-1/1-none.json.gz`

    await deps.objectStore.delete(key)

    const put = spyOn(deps.objectStore, 'put')
    const first = await readMatchInsightsFor(deps, matchId)

    expect(first?.version).toBe(1)
    expect(put.mock.calls.map(([putKey]) => putKey)).toEqual([key])

    const second = await readMatchInsightsFor(deps, matchId)

    expect(put).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  test('once the map has a layout, the next read works them out again with it', async () => {
    const matchId = await storedMatch()
    const layoutHash = createHash('sha1').update(mapPath).digest('hex').slice(0, 8)

    await addMapFile()

    const insights = await readMatchInsightsFor(deps, matchId)

    expect(insights?.version).toBe(1)
    expect(insightKeys(matchId)).toContain(`insights/${matchId}/dev-1/1-${layoutHash}.json.gz`)
  })

  test('a map file whose layout does not read leaves the insights without one', async () => {
    const matchId = await storedMatch()

    await addMapFile()
    await deps.artStore.put(mapPath, new TextEncoder().encode('{"format":3}'), 'application/json')
    await deps.objectStore.delete(`insights/${matchId}/dev-1/1-none.json.gz`)

    const errors = spyOn(console, 'error').mockImplementation(() => undefined)
    const insights = await readMatchInsightsFor(deps, matchId)

    errors.mockRestore()

    expect(insights?.version).toBe(1)
    expect(insightKeys(matchId)).toEqual([`insights/${matchId}/dev-1/1-none.json.gz`])
  })

  test('insights stored under an older version are not served', async () => {
    const matchId = await storedMatch()
    const stale = Bun.gzipSync(new TextEncoder().encode(JSON.stringify({ version: 0 })))

    await deps.objectStore.delete(`insights/${matchId}/dev-1/1-none.json.gz`)
    await deps.objectStore.put(`insights/${matchId}/dev-1/0-none.json.gz`, stale, 'application/gzip')

    const insights = await readMatchInsightsFor(deps, matchId)

    expect(insights?.version).toBe(1)
    expect(insightKeys(matchId)).toContain(`insights/${matchId}/dev-1/1-none.json.gz`)
  })

  test('a merged match answers the surviving match’s insights', async () => {
    const survivorId = await storedMatch()
    const mergedId = await storedMatch()

    await database.sql`UPDATE replays.matches SET merged_into = ${survivorId} WHERE id = ${mergedId}`

    expect(await readMatchInsightsFor(deps, mergedId)).toEqual(await readMatchInsightsFor(deps, survivorId))
  })

  test('a timed match has no insights', async () => {
    const matchId = await storedMatch(timedLine())

    expect(await readMatchInsightsFor(deps, matchId)).toBeNull()
  })

  test('a line whose insights fail is still stored, and the failure is logged with the match', async () => {
    const errors = spyOn(console, 'error').mockImplementation(() => undefined)
    const matchId = await storedMatch(brokenLine())
    const logged = errors.mock.calls.map(([message]) => String(message))

    errors.mockRestore()

    expect(insightKeys(matchId)).toEqual([])
    expect(logged).toEqual([expect.stringContaining(matchId)])
  })

  test('the match carries its insights, its art and where its playback is served', async () => {
    const matchId = await storedMatch()
    const readDeps = { ...deps, artBaseUrl }

    const match = await getMatch(readDeps, matchId)

    expect(match?.insights?.version).toBe(1)
    expect(match?.art).toEqual({ state: 'queued', manifestUrl: null, baseUrl: artBaseUrl })
    expect(match?.playbackPath).toBe(`/match/${matchId}/playback/dev-1`)
  })

  test('a failed export keeps the address of the last good manifest', async () => {
    const matchId = await storedMatch()
    const manifestKey = `matches/${matchId}/dev-1-lease/manifest.json`

    await database.sql`
      UPDATE replays.matches SET art_state = 'failed', art_manifest_key = ${manifestKey},
        art_failure = ${JSON.stringify({ code: 'worker-error' })}::text::jsonb
      WHERE id = ${matchId}
    `

    const match = await getMatch({ ...deps, artBaseUrl }, matchId)

    expect(match?.art).toEqual({ state: 'failed', manifestUrl: `${artBaseUrl}/${manifestKey}`, baseUrl: artBaseUrl })
  })

  test('without an art bucket the art has no addresses', async () => {
    const matchId = await storedMatch()

    const match = await getMatch({ ...deps, artStore: null, artBaseUrl: null }, matchId)

    expect(match?.art).toEqual({ state: 'queued', manifestUrl: null, baseUrl: null })
  })

  test('a timed match has no insights and no playback', async () => {
    const matchId = await storedMatch(timedLine())

    const match = await getMatch({ ...deps, artBaseUrl }, matchId)

    expect(match?.insights).toBeNull()
    expect(match?.playbackPath).toBeNull()
  })
})
