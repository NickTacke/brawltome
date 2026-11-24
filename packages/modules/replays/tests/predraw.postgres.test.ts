import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { type ClaimedArtJob, claimArtJob, readArtFile, waitForSets } from '../art'
import { completeArtJob } from '../art-complete'
import { queuePredrawJob, queueWarmJob } from '../art-queue'
import { storeArtFile } from '../art-upload'
import { replaysModule } from '../index'
import { claimJob, completeJob, type WorkerReport } from '../jobs'
import type { ReplaysDeps } from '../model'
import { uploadReplays } from '../upload'
import { fakeArtExport, fakeSetsExport } from './fixtures/art'
import { makeLine } from './fixtures/lines'
import { fakeReplay } from './fixtures/replays'

const connectionString = process.env.DATABASE_URL
// a worker whose export draws no sets, as every worker did before them, and one whose export does
const report: WorkerReport = { build: 'dev-1', patches: ['11.00'], artFormat: 3 }
const setsReport: WorkerReport = { ...report, setFormat: 4 }

type MemoryStore = ReturnType<typeof createMemoryObjectStore>

describe.skipIf(!connectionString)('predraw jobs and set indexes', () => {
  let database: TestDatabase
  let deps: ReplaysDeps & { objectStore: MemoryStore; artStore: MemoryStore }

  beforeAll(async () => {
    database = await createTestDatabase({ label: 'replays_predraw', modules: [...accountsTestModules, replaysModule] })
  }, 20_000)

  afterAll(async () => {
    await database?.drop()
  }, 20_000)

  beforeEach(async () => {
    await database.sql`
      TRUNCATE replays.art_jobs, replays.art_files, replays.map_files, replays.art_formats, replays.set_indexes,
        replays.jobs, replays.match_uploads, replays.match_players, replays.matches, replays.uploads,
        replays.replay_files, replays.worker_reports, replays.builds
    `

    // the worker already ran 11.00, dev-1 and format 3, and 11.00 was warmed, so claims queue nothing of their own
    await database.sql`INSERT INTO replays.worker_reports (patch) VALUES ('11.00')`
    await database.sql`INSERT INTO replays.builds (build) VALUES ('dev-1')`
    await database.sql`INSERT INTO replays.art_formats (format) VALUES (3)`
    await database.sql`INSERT INTO replays.art_jobs (kind, patch, status) VALUES ('warm', '11.00', 'completed')`

    deps = {
      database,
      objectStore: createMemoryObjectStore(),
      artStore: createMemoryObjectStore(),
      accounts: {} as Accounts,
    }
  })

  // an operator's upload, parsed by the worker into a stored match whose art job is queued
  async function parsedMatch(): Promise<string> {
    const accountId = randomUUID()

    await database.sql`INSERT INTO accounts.users (id) VALUES (${accountId})`

    const files = [new File([new Uint8Array(fakeReplay().bytes)], 'a.replay')]
    const [upload] = await uploadReplays(deps, { accountId, isOperator: true, files })
    const claimed = await claimJob(deps, report)

    await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine(),
    })

    const [match] = await database.sql<{ id: string }[]>`
      SELECT match_id AS id FROM replays.match_uploads WHERE upload_id = ${upload?.uploadId as string}
    `

    return match?.id as string
  }

  async function claimedPredrawJob(patch = '11.00'): Promise<ClaimedArtJob> {
    await queuePredrawJob(deps, patch)

    return (await claimArtJob(deps, setsReport)) as ClaimedArtJob
  }

  // sends every file of a predraw the bucket lacks, in the worker's order, and answers with its index
  async function predraw(claimed: ClaimedArtJob, sets = fakeSetsExport(claimed.patch)) {
    for (const [path, bytes] of sets.files) {
      expect(await storeArtFile(deps, claimed.jobId, claimed.leaseToken, path, bytes)).toMatchObject({
        status: expect.stringMatching(/^(stored|exists)$/),
      })
    }

    return completeArtJob(deps, claimed.jobId, claimed.leaseToken, {
      manifest: null,
      maps: [],
      artFormat: 3,
      setIndex: sets.indexPath,
    })
  }

  async function setIndexes() {
    const rows = await database.sql<{ patch: string; path: string; format: number }[]>`
      SELECT patch, path, format FROM replays.set_indexes
    `

    return [...rows]
  }

  async function jobOf(jobId: string) {
    const [job] = await database.sql<{ status: string; attempts: number; waiting: boolean }[]>`
      SELECT status, attempts, coalesce(wait_until > clock_timestamp(), false) AS waiting
      FROM replays.art_jobs WHERE id = ${jobId}
    `

    return job
  }

  test('a predraw job is queued once while it is active', async () => {
    await queuePredrawJob(deps, '11.00')
    await queuePredrawJob(deps, '11.00')

    const jobs = await database.sql`SELECT 1 FROM replays.art_jobs WHERE kind = 'predraw'`

    expect(jobs).toHaveLength(1)
  })

  test('a predraw job is claimed after warm jobs and before matches, only by a worker that draws sets', async () => {
    await parsedMatch()
    await queuePredrawJob(deps, '11.00')
    await queueWarmJob(deps, '11.01')

    const warm = await claimArtJob(deps, setsReport)
    const predrawJob = await claimArtJob(deps, setsReport)

    expect(warm?.kind).toBe('warm')
    expect(predrawJob).toMatchObject({ kind: 'predraw', patch: '11.00', matchId: null, line: null, setIndex: null })

    await database.sql`
      UPDATE replays.art_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL WHERE kind = 'predraw'
    `

    await database.sql`
      UPDATE replays.art_jobs SET status = 'completed', lease_token = NULL, lease_expires_at = NULL WHERE kind = 'warm'
    `

    // an older worker never sees a predraw job, and goes on with the match
    expect((await claimArtJob(deps, report))?.kind).toBe('match')
  })

  test("a predraw job's index becomes its patch's once every set it names is stored", async () => {
    const outcome = await predraw(await claimedPredrawJob())

    expect(outcome).toBe('completed')
    expect(await setIndexes()).toEqual([{ patch: '11.00', path: fakeSetsExport().indexPath, format: 4 }])
  })

  test('a set file is refused until its sheets and weight sheets are stored', async () => {
    const claimed = await claimedPredrawJob()
    const sets = fakeSetsExport()
    const [skinSet] = sets.sets as [string, string]
    const [base, weights] = sets.sheets as [string, string, string]

    const upload = (path: string) =>
      storeArtFile(deps, claimed.jobId, claimed.leaseToken, path, sets.files.get(path) as Uint8Array)

    await upload(base)

    expect(await upload(skinSet)).toEqual({
      status: 'rejected',
      reason: `${skinSet} names sheets the art bucket lacks (1), such as ${weights}`,
    })

    expect(deps.artStore.keys()).not.toContain(skinSet)

    await upload(weights)

    expect(await upload(skinSet)).toEqual({ status: 'stored' })
  })

  test('a format 3 art group is still stored before its sheets, as a match job sends it today', async () => {
    await parsedMatch()

    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob
    const art = fakeArtExport()
    const [groupPath, groupBytes] = [...art.files][0] as [string, Uint8Array]

    expect(await storeArtFile(deps, claimed.jobId, claimed.leaseToken, groupPath, groupBytes)).toEqual({
      status: 'stored',
    })
  })

  test('an index naming a set the bucket lacks fails the predraw job and becomes no patch index', async () => {
    const claimed = await claimedPredrawJob()
    const sets = fakeSetsExport()
    const [, classSet] = sets.sets as [string, string]

    sets.files.delete(classSet)

    expect(await predraw(claimed, sets)).toBe('failed')
    expect(await setIndexes()).toEqual([])
    expect((await jobOf(claimed.jobId))?.status).toBe('failed')
  })

  test('an index of another patch, or one the bucket lacks, fails the predraw job', async () => {
    const otherPatch = await claimedPredrawJob('11.00')

    expect(await predraw(otherPatch, fakeSetsExport('11.01'))).toBe('failed')

    await database.sql`DELETE FROM replays.art_jobs WHERE kind = 'predraw'`

    const unsent = await claimedPredrawJob('11.00')
    const result = { manifest: null, maps: [], artFormat: 3, setIndex: fakeSetsExport().indexPath }

    expect(await completeArtJob(deps, unsent.jobId, unsent.leaseToken, result)).toBe('failed')
    expect(await setIndexes()).toEqual([])
  })

  test('a predraw result without an index, or a match result with one, fails its job', async () => {
    const claimed = await claimedPredrawJob()
    const sets = fakeSetsExport()

    for (const [path, bytes] of sets.files) await storeArtFile(deps, claimed.jobId, claimed.leaseToken, path, bytes)

    const noIndex = await completeArtJob(deps, claimed.jobId, claimed.leaseToken, {
      manifest: null,
      maps: [],
      artFormat: 3,
    })

    expect(noIndex).toBe('failed')

    await parsedMatch()

    const matchJob = (await claimArtJob(deps, report)) as ClaimedArtJob
    const art = fakeArtExport()

    for (const [path, bytes] of art.files) await storeArtFile(deps, matchJob.jobId, matchJob.leaseToken, path, bytes)

    const withIndex = await completeArtJob(deps, matchJob.jobId, matchJob.leaseToken, {
      manifest: art.manifest,
      maps: [],
      artFormat: 3,
      setIndex: sets.indexPath,
    })

    expect(withIndex).toBe('failed')
    expect(await setIndexes()).toEqual([])
  })

  test('a later predraw of the patch replaces its index', async () => {
    await predraw(await claimedPredrawJob())
    await predraw(await claimedPredrawJob(), fakeSetsExport('11.00', 'two'))

    expect(await setIndexes()).toEqual([{ patch: '11.00', path: fakeSetsExport('11.00', 'two').indexPath, format: 4 }])
  })

  test("a match job carries its patch's index only to a worker that draws sets", async () => {
    await predraw(await claimedPredrawJob())
    await parsedMatch()

    const older = (await claimArtJob(deps, report)) as ClaimedArtJob

    expect(older).toMatchObject({ kind: 'match', setIndex: null })

    await database.sql`
      UPDATE replays.art_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${older.jobId}
    `

    expect(await claimArtJob(deps, setsReport)).toMatchObject({
      kind: 'match',
      setIndex: fakeSetsExport().indexPath,
    })
  })

  // render --sets refuses an index of another format and would fail the match for good
  test("a match job carries its patch's index only to a worker whose sets are the index's format", async () => {
    await predraw(await claimedPredrawJob())
    await parsedMatch()

    for (const setFormat of [3, 5]) {
      const claimed = (await claimArtJob(deps, { ...report, setFormat })) as ClaimedArtJob

      expect(claimed).toMatchObject({ kind: 'match', setIndex: null })

      await database.sql`
        UPDATE replays.art_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${claimed.jobId}
      `
    }

    expect(await claimArtJob(deps, setsReport)).toMatchObject({ kind: 'match', setIndex: fakeSetsExport().indexPath })
  })

  test("an index is kept with its own sets' format, whatever the worker that drew it reported", async () => {
    const sets = fakeSetsExport('11.00', 'one', 5)

    await predraw(await claimedPredrawJob(), sets)
    await parsedMatch()

    expect(await setIndexes()).toEqual([{ patch: '11.00', path: sets.indexPath, format: 5 }])
    expect(await claimArtJob(deps, setsReport)).toMatchObject({ kind: 'match', setIndex: null })

    await database.sql`
      UPDATE replays.art_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL WHERE kind = 'match'
    `

    expect(await claimArtJob(deps, { ...report, setFormat: 5 })).toMatchObject({ setIndex: sets.indexPath })
  })

  test('an index without a set format fails the predraw job', async () => {
    const claimed = await claimedPredrawJob()
    const sets = fakeSetsExport()
    const index = JSON.parse(new TextDecoder().decode(sets.files.get(sets.indexPath)))
    const indexBytes = new TextEncoder().encode(JSON.stringify({ ...index, format: undefined }))
    const indexPath = `sets/${createHash('sha256').update(indexBytes).digest('hex').slice(0, 32)}.json`

    sets.files.delete(sets.indexPath)
    sets.files.set(indexPath, indexBytes)

    expect(await predraw(claimed, { ...sets, indexPath })).toBe('failed')
    expect(await setIndexes()).toEqual([])
  })

  test('a match job of a patch without an index carries none', async () => {
    await predraw(await claimedPredrawJob('11.01'))
    await parsedMatch()

    expect(await claimArtJob(deps, setsReport)).toMatchObject({ kind: 'match', patch: '11.00', setIndex: null })
  })

  test("a set index can be read back by a match job's attempt", async () => {
    await predraw(await claimedPredrawJob())
    await parsedMatch()

    const claimed = (await claimArtJob(deps, setsReport)) as ClaimedArtJob
    const sets = fakeSetsExport()

    expect(await readArtFile(deps, claimed.jobId, claimed.leaseToken, sets.indexPath)).toEqual({
      status: 'found',
      bytes: sets.files.get(sets.indexPath) as Uint8Array,
    })
  })

  test('a match job waiting for its sets goes back unplayed, and is not claimed until its wait is over', async () => {
    await parsedMatch()

    const claimed = (await claimArtJob(deps, setsReport)) as ClaimedArtJob

    expect(await waitForSets(deps, claimed.jobId, claimed.leaseToken)).toBe(true)
    expect(await jobOf(claimed.jobId)).toEqual({ status: 'pending', attempts: 0, waiting: true })
    expect(await claimArtJob(deps, setsReport)).toBeNull()

    // the lease it waited with is gone
    expect(await waitForSets(deps, claimed.jobId, claimed.leaseToken)).toBe(false)

    await database.sql`UPDATE replays.art_jobs SET wait_until = clock_timestamp() - interval '1 second'`

    const again = (await claimArtJob(deps, setsReport)) as ClaimedArtJob

    expect(again.jobId).toBe(claimed.jobId)
    expect(await jobOf(claimed.jobId)).toEqual({ status: 'processing', attempts: 1, waiting: false })
  })

  test('a waiting match job lets the matches behind it be claimed', async () => {
    const older = await parsedMatch()
    const newer = await parsedMatch()

    await database.sql`UPDATE replays.matches SET played_at = now() - interval '1 day' WHERE id = ${older}`
    await database.sql`UPDATE replays.matches SET played_at = now() WHERE id = ${newer}`

    const waiting = (await claimArtJob(deps, setsReport)) as ClaimedArtJob

    expect(waiting.matchId).toBe(newer)

    await waitForSets(deps, waiting.jobId, waiting.leaseToken)

    expect((await claimArtJob(deps, setsReport))?.matchId).toBe(older)
  })

  test('only a match job can wait for sets', async () => {
    const claimed = await claimedPredrawJob()

    expect(await waitForSets(deps, claimed.jobId, claimed.leaseToken)).toBe(false)
    expect((await jobOf(claimed.jobId))?.status).toBe('processing')
  })
})
