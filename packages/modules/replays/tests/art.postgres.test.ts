import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { type ClaimedArtJob, claimArtJob, failArtJob, missingArtFiles, releaseArtJob, storeArtFile } from '../art'
import { completeArtJob } from '../art-complete'
import { queueArtJob, queueWarmJob } from '../art-queue'
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
  async function parsedMatch(): Promise<string> {
    const accountId = randomUUID()

    await database.sql`INSERT INTO accounts.users (id) VALUES (${accountId})`

    const files = [new File([new Uint8Array(fakeReplay().bytes)], 'a.replay')]
    const [upload] = await uploadReplays(deps, { accountId, isOperator: true, files })
    const claimed = await claimJob(deps, report)

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

    const manifestKey = `matches/${matchId}/dev-1/manifest.json`

    expect(await artOf(matchId)).toEqual({ state: 'ready', manifestKey, format: 3, failure: null })

    expect(JSON.parse(new TextDecoder().decode((await deps.artStore.get(manifestKey)) as Uint8Array))).toEqual(
      art.manifest,
    )

    expect(deps.artStore.keys()).toEqual([...art.files.keys(), manifestKey].sort())

    expect(await mapFiles()).toEqual([{ patch: '11.00', mapId: 136, path: art.mapPath }])
    expect((await artJobs())[0]?.status).toBe('completed')
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

    const manifestKey = `matches/${survivorId}/dev-1/manifest.json`

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
})
