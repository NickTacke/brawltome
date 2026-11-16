import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { type ClaimedArtJob, claimArtJob, failArtJob, missingArtFiles, readArtFile, releaseArtJob } from '../art'
import { completeArtJob } from '../art-complete'
import { queueArtJob, queueWarmJob } from '../art-queue'
import { storeArtFile } from '../art-upload'
import { replaysModule } from '../index'
import { claimJob, completeJob, type WorkerReport } from '../jobs'
import { noteWorkerReport } from '../maintenance'
import type { ReplaysDeps } from '../model'
import { uploadReplays } from '../upload'
import { fakeArtExport } from './fixtures/art'
import { makeLine } from './fixtures/lines'
import { fakeReplay } from './fixtures/replays'

const connectionString = process.env.DATABASE_URL
const report: WorkerReport = { build: 'dev-1', patches: ['11.00'], artFormat: null }

type MemoryStore = ReturnType<typeof createMemoryObjectStore>

describe.skipIf(!connectionString)('art jobs', () => {
  let database: TestDatabase
  let deps: ReplaysDeps & { objectStore: MemoryStore; artStore: MemoryStore }
  let earlierWarmJobId: string

  beforeAll(async () => {
    database = await createTestDatabase({ label: 'replays_art', modules: [...accountsTestModules, replaysModule] })
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

    // the worker already ran 11.00 and dev-1, and 11.00 was warmed, so claims queue no warm job or re-parse unless a
    // test says so
    await database.sql`INSERT INTO replays.worker_reports (patch) VALUES ('11.00')`
    await database.sql`INSERT INTO replays.builds (build) VALUES ('dev-1')`

    const [warmed] = await database.sql<{ id: string }[]>`
      INSERT INTO replays.art_jobs (kind, patch, status) VALUES ('warm', '11.00', 'completed') RETURNING id
    `

    earlierWarmJobId = warmed?.id as string

    deps = {
      database,
      objectStore: createMemoryObjectStore(),
      artStore: createMemoryObjectStore(),
      accounts: {} as Accounts,
    }
  })

  // an operator's upload, parsed by the worker into a stored match
  async function parsedMatch(workerReport: WorkerReport = report): Promise<string> {
    const accountId = randomUUID()

    await database.sql`INSERT INTO accounts.users (id) VALUES (${accountId})`

    const files = [new File([new Uint8Array(fakeReplay().bytes)], 'a.replay')]
    const [upload] = await uploadReplays(deps, { accountId, isOperator: true, files })
    const claimed = await claimJob(deps, workerReport)

    const outcome = await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine(),
    })

    expect(outcome).toBe('completed')

    const [match] = await database.sql<{ id: string }[]>`
      SELECT match_id AS id FROM replays.match_uploads WHERE upload_id = ${upload?.uploadId as string}
    `

    return match?.id as string
  }

  // a stored match whose art job the worker has claimed
  async function claimedMatchJob(): Promise<ClaimedArtJob> {
    await parsedMatch()

    return (await claimArtJob(deps, report)) as ClaimedArtJob
  }

  async function artOf(matchId: string) {
    const [match] = await database.sql<
      { state: string; manifestKey: string | null; format: number | null; failure: { code: string } | null }[]
    >`
      SELECT art_state AS state, art_manifest_key AS "manifestKey", art_format AS format, art_failure AS failure
      FROM replays.matches WHERE id = ${matchId}
    `

    return match
  }

  // the jobs this test queued
  async function artJobs() {
    const jobs = await database.sql<{ kind: string; matchId: string | null; patch: string; status: string }[]>`
      SELECT kind, match_id AS "matchId", patch, status FROM replays.art_jobs WHERE id <> ${earlierWarmJobId}
      ORDER BY created_at
    `

    return [...jobs]
  }

  async function mapFiles() {
    const maps = await database.sql<{ patch: string; mapId: number; path: string }[]>`
      SELECT patch, map_id AS "mapId", path FROM replays.map_files
    `

    return [...maps]
  }

  // the worker's whole art run: ask what's missing, send it, then the manifest
  async function exportArt(claimed: ClaimedArtJob, art = fakeArtExport()) {
    const { jobId, leaseToken } = claimed
    const missing = await missingArtFiles(deps, jobId, leaseToken, [...art.files.keys()])

    for (const path of missing === 'lease-lost' ? [] : missing) {
      const stored = await storeArtFile(deps, jobId, leaseToken, path, art.files.get(path) as Uint8Array)

      expect(stored).toEqual({ status: 'stored' })
    }

    return completeArtJob(deps, jobId, leaseToken, {
      manifest: art.manifest,
      maps: [{ patch: '11.00', mapId: 136, path: art.mapPath }],
      artFormat: 3,
    })
  }

  test('completing a parse job queues one art job and marks the match queued', async () => {
    const matchId = await parsedMatch()

    expect(await artJobs()).toEqual([{ kind: 'match', matchId, patch: '11.00', status: 'pending' }])
    expect((await artOf(matchId))?.state).toBe('queued')
  })

  test('without an art store a parse queues no art job', async () => {
    deps = { ...deps, artStore: null as unknown as MemoryStore }

    const matchId = await parsedMatch()

    expect(await artJobs()).toEqual([])
    expect((await artOf(matchId))?.state).toBe('none')
  })

  test('a claim hands out the match line, gzipped as stored', async () => {
    const matchId = await parsedMatch()
    const claimed = await claimArtJob(deps, report)

    expect(claimed).toMatchObject({ kind: 'match', patch: '11.00', matchId })

    const line = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(claimed?.line as Uint8Array))))

    expect(line.match.map.id).toBe(136)
  })

  test('claim, missing, store and complete make the art ready with its manifest', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob
    const art = fakeArtExport()

    expect(await exportArt(claimed, art)).toBe('completed')

    const manifestKey = `matches/${matchId}/dev-1-${claimed.leaseToken}/manifest.json`

    expect(await artOf(matchId)).toEqual({ state: 'ready', manifestKey, format: 3, failure: null })

    expect(JSON.parse(new TextDecoder().decode((await deps.artStore.get(manifestKey)) as Uint8Array))).toEqual(
      art.manifest,
    )

    expect(deps.artStore.keys()).toEqual([...art.files.keys(), manifestKey].sort())

    expect(await mapFiles()).toEqual([{ patch: '11.00', mapId: 136, path: art.mapPath }])
    expect((await artJobs())[0]?.status).toBe('completed')
  })

  test('a manifest key fits for the longest build a worker may report', async () => {
    const longBuild = { ...report, build: 'b'.repeat(64) }
    const matchId = await parsedMatch(longBuild)
    const claimed = (await claimArtJob(deps, longBuild)) as ClaimedArtJob

    expect(await exportArt(claimed)).toBe('completed')
    expect((await artOf(matchId))?.manifestKey).toContain(longBuild.build)
  })

  test('a later export replaces the manifest and deletes the one before', async () => {
    const matchId = await parsedMatch()
    const first = (await claimArtJob(deps, report)) as ClaimedArtJob

    await exportArt(first)
    await queueArtJob(deps, matchId)

    const second = (await claimArtJob(deps, report)) as ClaimedArtJob

    expect(await exportArt(second)).toBe('completed')

    const manifests = deps.artStore.keys().filter((key) => key.startsWith('matches/'))

    expect(manifests).toEqual([`matches/${matchId}/dev-1-${second.leaseToken}/manifest.json`])
    expect((await artOf(matchId))?.manifestKey).toBe(manifests[0] as string)
  })

  test('an attempt that stalls past its lease never replaces the manifest of the one after it', async () => {
    const matchId = await parsedMatch()
    const stalled = (await claimArtJob(deps, report)) as ClaimedArtJob
    const art = fakeArtExport()

    for (const [path, bytes] of art.files) await storeArtFile(deps, stalled.jobId, stalled.leaseToken, path, bytes)

    // the stalled attempt's manifest write waits until the attempt after it has finished
    const artStore = deps.artStore
    let letStalledWriteFinish = () => {}

    const stalledWriteMayFinish = new Promise<void>((resolve) => {
      letStalledWriteFinish = resolve
    })

    let markWriteStalled = () => {}

    const writeStalled = new Promise<void>((resolve) => {
      markWriteStalled = resolve
    })

    const stallingDeps = {
      ...deps,
      artStore: {
        ...artStore,
        put: async (key: string, body: Uint8Array, contentType: string) => {
          markWriteStalled()
          await stalledWriteMayFinish
          await artStore.put(key, body, contentType)
        },
      },
    }

    const result = { manifest: art.manifest, maps: [], artFormat: 3 }
    const stalledAnswer = completeArtJob(stallingDeps, stalled.jobId, stalled.leaseToken, result)

    await writeStalled

    await database.sql`
      UPDATE replays.art_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = ${stalled.jobId}
    `

    const next = (await claimArtJob(deps, report)) as ClaimedArtJob

    expect(await completeArtJob(deps, next.jobId, next.leaseToken, result)).toBe('completed')

    letStalledWriteFinish()

    expect(await stalledAnswer).toBe('lease-lost')

    const nextKey = `matches/${matchId}/dev-1-${next.leaseToken}/manifest.json`

    expect((await artOf(matchId))?.manifestKey).toBe(nextKey)
    expect(deps.artStore.keys().filter((key) => key.startsWith('matches/'))).toEqual([nextKey])
  })

  test('an export that finishes in a format older than one reported while it ran runs again', async () => {
    const matchId = await parsedMatch()

    await noteWorkerReport(deps, { ...report, artFormat: 3 })

    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob

    // the format arrives while the job runs, so the format re-queue passes this match by
    await noteWorkerReport(deps, { ...report, artFormat: 4 })

    expect(await exportArt(claimed)).toBe('completed')

    expect(await artOf(matchId)).toMatchObject({
      state: 'queued',
      format: 3,
      manifestKey: `matches/${matchId}/dev-1-${claimed.leaseToken}/manifest.json`,
    })

    expect((await claimArtJob(deps, report))?.matchId).toBe(matchId)
  })

  test('a worker rolled back to an older format exports each match once', async () => {
    const matchId = await parsedMatch()
    const first = (await claimArtJob(deps, report)) as ClaimedArtJob

    // format 4 is reported once while the job runs, then the worker goes back to 3
    await noteWorkerReport(deps, { ...report, artFormat: 4 })
    await noteWorkerReport(deps, { ...report, artFormat: 3 })

    expect(await exportArt(first)).toBe('completed')
    expect((await artOf(matchId))?.state).toBe('queued')

    expect(await exportArt((await claimArtJob(deps, report)) as ClaimedArtJob)).toBe('completed')
    expect(await artOf(matchId)).toMatchObject({ state: 'ready', format: 3 })
    expect(await claimArtJob(deps, report)).toBeNull()
  })

  test('an export in the newest format reported stays ready', async () => {
    const matchId = await parsedMatch()

    await noteWorkerReport(deps, { ...report, artFormat: 3 })

    expect(await exportArt((await claimArtJob(deps, report)) as ClaimedArtJob)).toBe('completed')
    expect((await artOf(matchId))?.state).toBe('ready')
    expect(await claimArtJob(deps, report)).toBeNull()
  })

  test('two overlapping completions of one attempt keep the manifest they published', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob
    const art = fakeArtExport()

    for (const [path, bytes] of art.files) await storeArtFile(deps, claimed.jobId, claimed.leaseToken, path, bytes)

    const result = { manifest: art.manifest, maps: [], artFormat: 3 }
    const stalling = stallingArtStore()

    const stalledCompletion = completeArtJob(
      { ...deps, artStore: stalling.store },
      claimed.jobId,
      claimed.leaseToken,
      result,
    )

    await stalling.writeStarted

    expect(await completeArtJob(deps, claimed.jobId, claimed.leaseToken, result)).toBe('completed')

    stalling.letWritesFinish()

    expect(await stalledCompletion).toBe('lease-lost')

    const manifestKey = `matches/${matchId}/dev-1-${claimed.leaseToken}/manifest.json`

    expect(await artOf(matchId)).toMatchObject({ state: 'ready', manifestKey })
    expect(deps.artStore.keys()).toContain(manifestKey)
  })

  test('a replaced manifest that a merged match still points at is kept', async () => {
    const mergedId = await parsedMatch()
    const mergedJob = (await claimArtJob(deps, report)) as ClaimedArtJob
    const survivorId = await parsedMatch()

    await database.sql`UPDATE replays.matches SET merged_into = ${survivorId} WHERE id = ${mergedId}`
    await exportArt(mergedJob)

    const sharedKey = `matches/${survivorId}/dev-1-${mergedJob.leaseToken}/manifest.json`
    const survivorJob = (await claimArtJob(deps, report)) as ClaimedArtJob

    expect(survivorJob.matchId).toBe(survivorId)
    expect(await exportArt(survivorJob)).toBe('completed')
    expect((await artOf(mergedId))?.manifestKey).toBe(sharedKey)
    expect(deps.artStore.keys()).toContain(sharedKey)
  })

  test('only files the art bucket lacks are asked for', async () => {
    await exportArt(await claimedMatchJob())

    const second = await claimedMatchJob()
    const again = fakeArtExport()
    const newSheet = fakeArtExport('two').manifest.sheetOrder[0] as string

    const missing = await missingArtFiles(deps, second.jobId, second.leaseToken, [...again.files.keys(), newSheet])

    expect(missing).toEqual([newSheet])
  })

  test('a manifest naming a file the bucket lacks fails the job and stores nothing', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob
    const art = fakeArtExport()
    const [skipped] = art.files.keys()

    for (const [path, bytes] of art.files) {
      if (path !== skipped) await storeArtFile(deps, claimed.jobId, claimed.leaseToken, path, bytes)
    }

    const outcome = await completeArtJob(deps, claimed.jobId, claimed.leaseToken, {
      manifest: art.manifest,
      maps: [{ patch: '11.00', mapId: 136, path: art.mapPath }],
      artFormat: 3,
    })

    expect(outcome).toBe('failed')
    expect(deps.artStore.keys().filter((key) => key.startsWith('matches/'))).toEqual([])
    expect(await mapFiles()).toEqual([])
    expect((await artOf(matchId))?.state).toBe('failed')
  })

  test('a manifest of another format fails the job', async () => {
    const claimed = await claimedMatchJob()
    const art = fakeArtExport()

    for (const [path, bytes] of art.files) await storeArtFile(deps, claimed.jobId, claimed.leaseToken, path, bytes)

    const outcome = await completeArtJob(deps, claimed.jobId, claimed.leaseToken, {
      manifest: { ...art.manifest, format: 2 },
      maps: [],
      artFormat: 3,
    })

    expect(outcome).toBe('failed')
  })

  test('a file that fails its check is rejected and not stored', async () => {
    const claimed = await claimedMatchJob()
    const bytes = new TextEncoder().encode('RIFF\0\0\0\0WEBPlies')

    const stored = await storeArtFile(deps, claimed.jobId, claimed.leaseToken, 'sheets/0123456789abcdef.webp', bytes)

    expect(stored).toMatchObject({ status: 'rejected' })
    expect(deps.artStore.keys()).toEqual([])
    expect(await database.sql`SELECT 1 FROM replays.art_files`).toHaveLength(0)
  })

  test('a file from an attempt that lost its lease is not stored', async () => {
    const claimed = await claimedMatchJob()
    const art = fakeArtExport()
    const [path, bytes] = [...art.files][0] as [string, Uint8Array]

    await releaseArtJob(deps, claimed.jobId, claimed.leaseToken)

    expect(await storeArtFile(deps, claimed.jobId, claimed.leaseToken, path, bytes)).toEqual({ status: 'lease-lost' })
    expect(deps.artStore.keys()).toEqual([])
  })

  test('a stored art group or map file can be read back, a sheet cannot', async () => {
    await exportArt(await claimedMatchJob())

    const claimed = await claimedMatchJob()
    const art = fakeArtExport()
    const [groupPath, groupBytes] = [...art.files][0] as [string, Uint8Array]
    const sheetPath = art.manifest.sheetOrder[0] as string
    const read = (path: string) => readArtFile(deps, claimed.jobId, claimed.leaseToken, path)

    expect(await read(groupPath)).toEqual({ status: 'found', bytes: groupBytes })
    expect(await read(art.mapPath)).toEqual({ status: 'found', bytes: art.files.get(art.mapPath) as Uint8Array })
    expect(await read(sheetPath)).toMatchObject({ status: 'refused' })
    expect(await read(`art/${'f'.repeat(32)}.json`)).toEqual({ status: 'not-found' })
  })

  test('a read from an attempt that lost its lease is refused', async () => {
    const claimed = await claimedMatchJob()

    await releaseArtJob(deps, claimed.jobId, claimed.leaseToken)

    const read = await readArtFile(deps, claimed.jobId, claimed.leaseToken, fakeArtExport().mapPath)

    expect(read).toEqual({ status: 'lease-lost' })
  })

  // two stored matches, each with its art job claimed by its own attempt
  async function twoClaimedJobs(): Promise<[ClaimedArtJob, ClaimedArtJob]> {
    await parsedMatch()
    await parsedMatch()

    const first = (await claimArtJob(deps, report)) as ClaimedArtJob
    const second = (await claimArtJob(deps, report)) as ClaimedArtJob

    return [first, second]
  }

  // an art store whose writes wait until the test lets them finish
  function stallingArtStore() {
    const artStore = deps.artStore
    let letWritesFinish = () => {}

    const writesMayFinish = new Promise<void>((resolve) => {
      letWritesFinish = resolve
    })

    let markWriteStarted = () => {}

    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })

    const store = {
      ...artStore,
      put: async (key: string, body: Uint8Array, contentType: string) => {
        markWriteStarted()
        await writesMayFinish
        await artStore.put(key, body, contentType)
      },
    }

    return { store, writeStarted, letWritesFinish: () => letWritesFinish() }
  }

  test('of two overlapping uploads of one path, only the first is stored', async () => {
    const [first, second] = await twoClaimedJobs()
    const path = `art/${'c'.repeat(32)}.json`
    const firstBytes = new TextEncoder().encode('{"from":"first"}')
    const stalling = stallingArtStore()

    const firstUpload = storeArtFile(
      { ...deps, artStore: stalling.store },
      first.jobId,
      first.leaseToken,
      path,
      firstBytes,
    )

    await stalling.writeStarted

    const secondBytes = new TextEncoder().encode('{"from":"second"}')

    expect(await storeArtFile(deps, second.jobId, second.leaseToken, path, secondBytes)).toEqual({
      status: 'in-progress',
    })

    expect(await missingArtFiles(deps, second.jobId, second.leaseToken, [path])).toEqual([path])

    stalling.letWritesFinish()

    expect(await firstUpload).toEqual({ status: 'stored' })
    expect(await storeArtFile(deps, second.jobId, second.leaseToken, path, secondBytes)).toEqual({ status: 'exists' })
    expect(await deps.artStore.get(path)).toEqual(firstBytes)
    expect(await missingArtFiles(deps, second.jobId, second.leaseToken, [path])).toEqual([])
  })

  test('an upload left unfinished is taken over once its attempt has lost its lease', async () => {
    const [first, second] = await twoClaimedJobs()
    const path = `maps/${'d'.repeat(32)}.json`
    const bytes = new TextEncoder().encode('{"mapId":136}')

    const failingStore = {
      ...deps.artStore,
      put: async () => {
        throw new Error('connection reset')
      },
    }

    await expect(
      storeArtFile({ ...deps, artStore: failingStore }, first.jobId, first.leaseToken, path, bytes),
    ).rejects.toThrow()

    expect(await storeArtFile(deps, second.jobId, second.leaseToken, path, bytes)).toEqual({ status: 'in-progress' })

    await database.sql`
      UPDATE replays.art_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = ${first.jobId}
    `

    expect(await storeArtFile(deps, second.jobId, second.leaseToken, path, bytes)).toEqual({ status: 'stored' })
    expect(await deps.artStore.get(path)).toEqual(bytes)
  })

  test('the same attempt may retry an upload that failed', async () => {
    const [first] = await twoClaimedJobs()
    const path = `art/${'e'.repeat(32)}.json`
    const bytes = new TextEncoder().encode('{}')

    const failingStore = {
      ...deps.artStore,
      put: async () => {
        throw new Error('connection reset')
      },
    }

    await expect(
      storeArtFile({ ...deps, artStore: failingStore }, first.jobId, first.leaseToken, path, bytes),
    ).rejects.toThrow()

    expect(await storeArtFile(deps, first.jobId, first.leaseToken, path, bytes)).toEqual({ status: 'stored' })
  })

  test('a duplicate upload from the same attempt finds the path already stored', async () => {
    const [first] = await twoClaimedJobs()
    const path = `art/${'f'.repeat(32)}.json`
    const bytes = new TextEncoder().encode('{}')
    const stalling = stallingArtStore()

    const stalledUpload = storeArtFile(
      { ...deps, artStore: stalling.store },
      first.jobId,
      first.leaseToken,
      path,
      bytes,
    )

    await stalling.writeStarted

    expect(await storeArtFile(deps, first.jobId, first.leaseToken, path, bytes)).toEqual({ status: 'stored' })

    stalling.letWritesFinish()

    expect(await stalledUpload).toEqual({ status: 'exists' })
  })

  test('a manifest naming a file still being uploaded is refused', async () => {
    const claimed = await claimedMatchJob()
    const art = fakeArtExport()

    for (const [path, bytes] of art.files) await storeArtFile(deps, claimed.jobId, claimed.leaseToken, path, bytes)

    await database.sql`
      UPDATE replays.art_files SET state = 'uploading', job_id = ${claimed.jobId}, lease_token = ${claimed.leaseToken}
      WHERE path = ${art.mapPath}
    `

    const outcome = await completeArtJob(deps, claimed.jobId, claimed.leaseToken, {
      manifest: art.manifest,
      maps: [{ patch: '11.00', mapId: 136, path: art.mapPath }],
      artFormat: 3,
    })

    expect(outcome).toBe('failed')
  })

  test('no-animations marks the art failed with that code', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob

    const failed = await failArtJob(deps, claimed.jobId, claimed.leaseToken, {
      code: 'no-animations',
      message: 'the line has no timeline.animations',
    })

    expect(failed).toBe(true)
    expect(await artOf(matchId)).toMatchObject({ state: 'failed', failure: { code: 'no-animations' } })
    expect(await claimArtJob(deps, report)).toBeNull()
  })

  test('a worker-error is retried', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob

    await failArtJob(deps, claimed.jobId, claimed.leaseToken, { code: 'worker-error', message: 'killed' })

    expect((await artOf(matchId))?.state).toBe('queued')
    expect((await claimArtJob(deps, report))?.jobId).toBe(claimed.jobId)
  })

  test('a second queueArtJob while one is active does nothing', async () => {
    const matchId = await parsedMatch()

    await queueArtJob(deps, matchId)
    await claimArtJob(deps, report)
    await queueArtJob(deps, matchId)

    expect(await artJobs()).toHaveLength(1)
  })

  test('a job for a match that was merged writes the manifest under the surviving match', async () => {
    const mergedId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob
    const survivorId = await parsedMatch()

    await database.sql`UPDATE replays.matches SET merged_into = ${survivorId} WHERE id = ${mergedId}`

    expect(await exportArt(claimed)).toBe('completed')

    const manifestKey = `matches/${survivorId}/dev-1-${claimed.leaseToken}/manifest.json`

    expect(await artOf(survivorId)).toMatchObject({ state: 'ready', manifestKey })
    expect(deps.artStore.keys()).toContain(manifestKey)
    expect(deps.artStore.keys().filter((key) => key.includes(mergedId))).toEqual([])
  })

  test('art from a line a re-parse has since replaced is refused, and the job runs again', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob

    await database.sql`UPDATE replays.matches SET timeline_key = 'timelines/newer.json.gz' WHERE id = ${matchId}`

    expect(await exportArt(claimed)).toBe('lease-lost')
    expect(deps.artStore.keys().filter((key) => key.startsWith('matches/'))).toEqual([])
    expect(await artJobs()).toMatchObject([{ status: 'pending' }])
    expect((await artOf(matchId))?.state).toBe('queued')
  })

  // what a re-parse does to a match's line while its art job runs
  async function replaceLine(matchId: string): Promise<string> {
    const newerKey = `timelines/${matchId}/newer.json.gz`

    await deps.objectStore.put(newerKey, Bun.gzipSync(new TextEncoder().encode(makeLine())), 'application/gzip')
    await database.sql`UPDATE replays.matches SET timeline_key = ${newerKey} WHERE id = ${matchId}`

    return newerKey
  }

  test('a failure for a line a re-parse has since replaced puts the job back', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob

    await replaceLine(matchId)

    const failure = { code: 'no-animations' as const, message: 'the line has no timeline.animations' }

    expect(await failArtJob(deps, claimed.jobId, claimed.leaseToken, failure)).toBe(true)
    expect(await artOf(matchId)).toMatchObject({ state: 'queued', failure: null })
    expect(await artJobs()).toMatchObject([{ status: 'pending' }])
  })

  test('a refused result for a line a re-parse has since replaced puts the job back', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob

    await replaceLine(matchId)

    const outcome = await completeArtJob(deps, claimed.jobId, claimed.leaseToken, {
      manifest: fakeArtExport().manifest,
      maps: [],
      artFormat: 3,
    })

    expect(outcome).toBe('lease-lost')
    expect((await artOf(matchId))?.state).toBe('queued')
    expect(await artJobs()).toMatchObject([{ status: 'pending' }])
  })

  test('a job out of attempts whose line was replaced runs again on the new line', async () => {
    const matchId = await parsedMatch()
    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob
    const newerKey = await replaceLine(matchId)

    await database.sql`
      UPDATE replays.art_jobs SET attempts = 3, lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${claimed.jobId}
    `

    const again = await claimArtJob(deps, report)

    expect(again?.jobId).toBe(claimed.jobId)
    expect(again?.line).toEqual(await deps.objectStore.get(newerKey))
    expect((await artOf(matchId))?.state).toBe('queued')
  })

  test('a claim whose line a re-parse deletes before it is read hands out the new line', async () => {
    const matchId = await parsedMatch()
    const objectStore = deps.objectStore

    const [{ oldKey }] = await database.sql<{ oldKey: string }[]>`
      SELECT timeline_key AS "oldKey" FROM replays.matches WHERE id = ${matchId}
    `

    let newerKey = ''

    deps = {
      ...deps,
      objectStore: {
        ...objectStore,
        get: async (key) => {
          if (key !== oldKey || newerKey) return objectStore.get(key)

          newerKey = await replaceLine(matchId)
          await objectStore.delete(oldKey)

          return null
        },
      },
    }

    const claimed = await claimArtJob(deps, report)

    expect(claimed?.matchId).toBe(matchId)
    expect(claimed?.line).toEqual(await objectStore.get(newerKey))
    expect((await artOf(matchId))?.state).toBe('queued')
  })

  test('warm jobs are claimed first, then the newest match', async () => {
    const older = await parsedMatch()
    const newer = await parsedMatch()

    await database.sql`UPDATE replays.matches SET played_at = now() - interval '1 day' WHERE id = ${older}`
    await database.sql`UPDATE replays.matches SET played_at = now() WHERE id = ${newer}`
    await queueWarmJob(deps, '11.00')

    const order = []

    for (let claim = 0; claim < 3; claim++) {
      const claimed = await claimArtJob(deps, report)

      order.push(claimed?.kind === 'warm' ? 'warm' : claimed?.matchId)
    }

    expect(order).toEqual(['warm', newer, older])
  })

  test('a warm job stores its maps without a manifest', async () => {
    await queueWarmJob(deps, '11.00')

    const claimed = (await claimArtJob(deps, report)) as ClaimedArtJob
    const art = fakeArtExport()

    expect(claimed).toMatchObject({ kind: 'warm', matchId: null, line: null })

    await storeArtFile(deps, claimed.jobId, claimed.leaseToken, art.mapPath, art.files.get(art.mapPath) as Uint8Array)

    const outcome = await completeArtJob(deps, claimed.jobId, claimed.leaseToken, {
      manifest: null,
      maps: [{ patch: '11.00', mapId: 136, path: art.mapPath }],
      artFormat: 3,
    })

    expect(outcome).toBe('completed')
    expect(await mapFiles()).toEqual([{ patch: '11.00', mapId: 136, path: art.mapPath }])
  })

  test('a report queues one warm job for each patch never warmed, even one reported before art', async () => {
    await database.sql`INSERT INTO replays.worker_reports (patch) VALUES ('10.09')`

    await noteWorkerReport(deps, { ...report, patches: ['11.00', '10.09', '11.01'] })
    await noteWorkerReport(deps, { ...report, patches: ['11.00', '10.09', '11.01'] })

    expect(await artJobs()).toEqual([
      { kind: 'warm', matchId: null, patch: '10.09', status: 'pending' },
      { kind: 'warm', matchId: null, patch: '11.01', status: 'pending' },
    ])
  })

  test('a patch whose warm job failed is not warmed again on its own', async () => {
    await database.sql`
      INSERT INTO replays.art_jobs (kind, patch, status, failure)
      VALUES ('warm', '11.01', 'failed', '{"code":"export-failed","message":"x"}')
    `

    await noteWorkerReport(deps, { ...report, patches: ['11.01'] })

    expect((await artJobs()).filter((job) => job.status === 'pending')).toEqual([])
  })

  test('a report with a new art format queues art only for matches drawn in another format', async () => {
    const current = await parsedMatch()
    const outdated = await parsedMatch()
    const never = await parsedMatch()

    await database.sql`UPDATE replays.art_jobs SET status = 'completed'`
    await database.sql`UPDATE replays.matches SET art_state = 'ready', art_format = 3, art_manifest_key = 'k' WHERE id = ${current}`
    await database.sql`UPDATE replays.matches SET art_state = 'ready', art_format = 2, art_manifest_key = 'k' WHERE id = ${outdated}`
    await database.sql`UPDATE replays.matches SET art_state = 'none' WHERE id = ${never}`

    await noteWorkerReport(deps, { ...report, artFormat: 3 })
    await noteWorkerReport(deps, { ...report, artFormat: 3 })

    const pending = (await artJobs()).filter((job) => job.status === 'pending').map((job) => job.matchId)

    expect(pending.sort()).toEqual([outdated, never].sort())
    expect((await artOf(outdated))?.state).toBe('queued')
  })

  test('a new art format is only recorded once its matches are queued', async () => {
    const matchId = await parsedMatch()

    await database.sql`UPDATE replays.art_jobs SET status = 'completed'`

    await database.sql.unsafe(`
      CREATE FUNCTION replays.refuse_art_job() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'art job refused'; END $$
    `)

    await database.sql.unsafe(`
      CREATE TRIGGER refuse_art_job BEFORE INSERT ON replays.art_jobs
      FOR EACH ROW EXECUTE FUNCTION replays.refuse_art_job()
    `)

    try {
      await expect(noteWorkerReport(deps, { ...report, artFormat: 3 })).rejects.toThrow('art job refused')
    } finally {
      await database.sql.unsafe('DROP TRIGGER refuse_art_job ON replays.art_jobs')
      await database.sql.unsafe('DROP FUNCTION replays.refuse_art_job()')
    }

    await noteWorkerReport(deps, { ...report, artFormat: 3 })

    const pending = (await artJobs()).filter((job) => job.status === 'pending')

    expect(pending).toEqual([{ kind: 'match', matchId, patch: '11.00', status: 'pending' }])
  })
})
