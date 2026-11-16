import type { ObjectStore, Sql, TransactionSql } from '@brawltome/foundation'
import { findLiveArtJob, finishArtWithFailure, giveBack, type LiveArtJob } from './art-lease'
import { readManifestPaths } from './art-manifest'
import { parseArtPath } from './art-paths'
import type { CompleteOutcome } from './jobs'
import { manifestKey } from './keys'
import { MAX_ART_FILE_BYTES, MAX_MERGE_HOPS } from './limits'
import type { ReplaysDeps } from './model'

// the worker's last answer for an art job: the manifest (none for a warm job) and the map files it exported. nothing
// is stored unless every file named is already in the art bucket

export type ArtMap = { patch: string; mapId: number; path: string }
export type ArtResult = { manifest: unknown | null; maps: ArtMap[]; artFormat: number }

type MatchLine = { build: string; timelineKey: string | null }

// map_id is a postgres integer
const MAX_MAP_ID = 2_147_483_647

/** Stores the manifest and map files of an art job and makes the match's art ready. */
export async function completeArtJob(
  deps: ReplaysDeps,
  jobId: string,
  leaseToken: string,
  result: ArtResult,
): Promise<CompleteOutcome> {
  const artStore = deps.artStore

  if (!artStore) throw new Error(`complete art job ${jobId}: this process has no art bucket`)

  const sql = deps.database.sql
  const job = await findLiveArtJob(sql, jobId, leaseToken)

  if (job === 'not-found' || job === 'lease-lost') return job

  const problem = await resultProblem(sql, job, result)

  if (problem) {
    const failure = { code: 'export-failed' as const, message: problem.slice(0, 500) }
    const isRecorded = await finishArtWithFailure(sql, { id: jobId, leaseToken }, failure, true)

    return isRecorded ? 'failed' : 'lease-lost'
  }

  if (job.kind === 'warm') return storeMaps(sql, { id: jobId, leaseToken }, result)

  return storeManifest({ sql, artStore }, { ...job, leaseToken }, result)
}

// why the result can't be stored, or null when it can
async function resultProblem(sql: Sql, job: LiveArtJob, result: ArtResult): Promise<string | null> {
  if (!Number.isInteger(result.artFormat) || result.artFormat < 1 || result.artFormat > 32767) {
    return `art format ${result.artFormat} is not a format number`
  }

  const badMap = result.maps.find((map) => !isMapEntry(map, job.patch))

  if (badMap) return `the map entry ${JSON.stringify(badMap).slice(0, 200)} is not a map file of patch ${job.patch}`

  const manifestPaths = pathsOf(job, result.manifest)

  if ('reason' in manifestPaths) return manifestPaths.reason

  const missing = await notStored(sql, [...manifestPaths.paths, ...result.maps.map((map) => map.path)])

  if (missing.length > 0) return `the art bucket lacks ${missing.length} named files, such as ${missing[0]}`

  return null
}

function pathsOf(job: LiveArtJob, manifest: unknown): { paths: string[] } | { reason: string } {
  if (job.kind === 'warm') return manifest === null ? { paths: [] } : { reason: 'a warm job has no manifest' }

  if (manifest === null) return { reason: 'a match job needs a manifest' }

  if (JSON.stringify(manifest).length > MAX_ART_FILE_BYTES) return { reason: 'the manifest is over the size cap' }

  return readManifestPaths(manifest)
}

// a job only exports the maps of its own patch
function isMapEntry(map: ArtMap, patch: string): boolean {
  const isMapId = Number.isInteger(map.mapId) && map.mapId >= 0 && map.mapId <= MAX_MAP_ID

  return map.patch === patch && isMapId && parseArtPath(map.path)?.kind === 'map'
}

async function notStored(sql: Sql, paths: string[]): Promise<string[]> {
  const stored = await sql<{ path: string }[]>`SELECT path FROM replays.art_files WHERE path = ANY(${paths}::text[])`
  const storedPaths = new Set(stored.map(({ path }) => path))

  return paths.filter((path) => !storedPaths.has(path))
}

async function storeMaps(
  sql: Sql,
  job: { id: string; leaseToken: string },
  result: ArtResult,
): Promise<CompleteOutcome> {
  return finishJob(sql, job, async (transaction) => {
    await saveMaps(transaction, result)

    return true
  })
}

async function storeManifest(
  stores: { sql: Sql; artStore: ObjectStore },
  job: LiveArtJob & { leaseToken: string },
  result: ArtResult,
): Promise<CompleteOutcome> {
  const { sql, artStore } = stores
  const matchId = job.matchId as string
  const line = await lineOf(sql, matchId)

  // a re-parse replaced the line this art was drawn from; the job goes back to run again on the new one
  if (!line || line.timelineKey !== job.timelineKey) {
    await giveBack(sql, job, { isAttempt: false })

    return 'lease-lost'
  }

  const survivorId = await survivingMatchId(sql, matchId)
  const key = manifestKey(survivorId, line.build)

  // the manifest first, so a match marked ready always has one
  await artStore.put(key, new TextEncoder().encode(JSON.stringify(result.manifest)), 'application/json')

  return finishJob(sql, job, async (transaction) => {
    // checked again under the match's lock, since a re-parse may have committed since the check above
    const [match] = await transaction<{ timelineKey: string | null }[]>`
      SELECT timeline_key AS "timelineKey" FROM replays.matches WHERE id = ${matchId} FOR UPDATE
    `

    if (match?.timelineKey !== job.timelineKey) return false

    await saveMaps(transaction, result)

    await transaction`
      UPDATE replays.matches SET art_state = 'ready', art_manifest_key = ${key}, art_format = ${result.artFormat},
        art_failure = NULL
      WHERE id IN (${matchId}, ${survivorId})
    `

    return true
  })
}

async function lineOf(sql: Sql, matchId: string): Promise<MatchLine | null> {
  const [line] = await sql<MatchLine[]>`
    SELECT build, timeline_key AS "timelineKey" FROM replays.matches WHERE id = ${matchId}
  `

  return line ?? null
}

// a match merged into another shows the art under the one it was merged into
async function survivingMatchId(sql: Sql, matchId: string): Promise<string> {
  let currentId = matchId

  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const [row] = await sql<{ mergedInto: string | null }[]>`
      SELECT merged_into AS "mergedInto" FROM replays.matches WHERE id = ${currentId}
    `

    if (!row?.mergedInto) return currentId

    currentId = row.mergedInto
  }

  return currentId
}

async function saveMaps(transaction: TransactionSql, result: ArtResult): Promise<void> {
  for (const map of result.maps) {
    await transaction`
      INSERT INTO replays.map_files (patch, map_id, path) VALUES (${map.patch}, ${map.mapId}, ${map.path})
      ON CONFLICT (patch, map_id) DO UPDATE SET path = excluded.path
    `
  }
}

// the lease is checked again under the row lock, so an attempt that lost it in the meantime writes nothing. write
// answers false when the job's line was replaced, and the job then goes back to the queue
async function finishJob(
  sql: Sql,
  job: { id: string; leaseToken: string },
  write: (transaction: TransactionSql) => Promise<boolean>,
): Promise<CompleteOutcome> {
  return sql.begin(async (transaction) => {
    const [locked] = await transaction<{ ok: boolean }[]>`
      SELECT (status = 'processing' AND lease_token = ${job.leaseToken} AND lease_expires_at > clock_timestamp()) AS ok
      FROM replays.art_jobs WHERE id = ${job.id} FOR UPDATE
    `

    if (!locked?.ok) return 'lease-lost' as const

    const isWritten = await write(transaction)

    if (!isWritten) {
      await giveBack(transaction, job, { isAttempt: false })

      return 'lease-lost' as const
    }

    await transaction`
      UPDATE replays.art_jobs SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
        updated_at = clock_timestamp()
      WHERE id = ${job.id}
    `

    return 'completed' as const
  })
}
