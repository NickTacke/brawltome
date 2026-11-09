import {
  type AttemptOutcome,
  type ClanWeeklySnapshotPayload,
  defineJob,
  type JobDefinition,
  JobLeaseLostError,
  type JobTools,
  type Lease,
  type RetryTimings,
  type SourceAdmitter,
} from '@brawltome/queue'
import type { Telemetry } from '@brawltome/telemetry'
import type { PostgresWeeklySnapshots } from '../db/postgres-weekly-snapshots'
import type { WeeklySnapshotWriteResult } from '../db/weekly-snapshot-lease'
import { type ClanProfileWrite, parseGuildRank, parseGuildStats } from '../domain/guild-stats'
import { failedCheckProvenance, successProvenance, weeklySnapshotProvenance } from '../domain/provenance'
import { classifySourceFailure } from '../domain/source-failure'
import { withoutNulCharacters } from '../domain/source-values'
import { clanWeeklySnapshotContract } from './clan-weekly-snapshot-contract'
import type { ClanSource } from './refresh-clan'
import { ClanWeeklySnapshotSourceDown, ClanWeeklySnapshotYield, decideSnapshotFailure } from './weekly-snapshot-failure'
import { fetchGuildStats, type GuildStatsFetcher, markAdmissionFailures } from './weekly-snapshot-fetch'

export const defaultClanWeeklySnapshotSliceGuilds = 100

// guilds in a row that fail every retry before the run takes V1 to be down and waits. Each has failed three calls
// over about 2.5 s, so five in a row is 15 failed calls: a 1% error rate or a few broken guilds won't get there
export const clanWeeklySnapshotOutageGuilds = 5

// how long the run waits out guilds failing in a row before it takes them for broken guilds instead. Brawlhalla's
// maintenance and outages take an hour or two, so a failure that lasts longer is more likely five broken neighbours,
// or a lasting error on the worker's side, than V1 being down
export const clanWeeklySnapshotOutageLimitMs = 6 * 60 * 60 * 1000

export type ClanWeeklySnapshotJobDependencies = {
  snapshots: PostgresWeeklySnapshots
  // the Brawlhalla client, with every call going through this attempt's admission
  createAdmittedSource(admitSource: SourceAdmitter): Pick<ClanSource, 'getGuildStatsV1'>
  sliceGuilds: number
  guildDelayMs: number
  waitBetweenGuilds(delayMs: number, signal: AbortSignal): Promise<void>
  waitBeforeGuildRetry(delayMs: number, signal: AbortSignal): Promise<void>
  retryTimings: RetryTimings
  telemetry: Telemetry
}

type WeeklySnapshotLease = Lease<ClanWeeklySnapshotPayload>

type SnapshotSlice = {
  weekStarting: string
  lease: WeeklySnapshotLease
  dependencies: ClanWeeklySnapshotJobDependencies
  fetcher: GuildStatsFetcher
  tools: JobTools
}

type FailedGuild = { clanId: number; error: unknown }

type SliceProgress = {
  storedGuilds: number
  skippedGuilds: number
  failedGuilds: FailedGuild[]
  // the run row notes when guilds started failing in a row, until one answers
  isSourceDown: boolean
}

function weekStartingOf(lease: WeeklySnapshotLease): string {
  const windowAt = new Date(lease.scheduleWindowAt ?? lease.effectCreatedAt)

  return windowAt.toISOString().slice(0, 10)
}

// every write checks the lease in its own transaction; a worker that lost it stops before writing anything more
function requireLease<Result>(result: WeeklySnapshotWriteResult<Result>): Result {
  if (result === 'lease-lost') throw new JobLeaseLostError()

  return result
}

// a 404 can't be told from a hiccup and a payload that doesn't parse won't parse on a retry, so such a guild
// misses this week instead of holding up the others
function readProfile(payload: unknown | null, clanId: number): { profile: ClanProfileWrite } | { error: unknown } {
  if (payload === null) return { error: new Error('ambiguous guild stats 404') }

  try {
    return { profile: parseGuildStats(withoutNulCharacters(payload), clanId) }
  } catch (error) {
    return { error }
  }
}

// records the failed check the way a refresh does and moves the run past the guild, which misses this week
async function skipGuild(slice: SnapshotSlice, clanId: number, error: unknown): Promise<void> {
  const { weekStarting, lease, dependencies } = slice
  const provenance = weeklySnapshotProvenance(failedCheckProvenance('profile', classifySourceFailure(error)))
  const skipped = { weekStarting, clanId, checkedAt: new Date(), provenance }

  requireLease(await dependencies.snapshots.skipGuild(lease, skipped))
}

async function saveGuild(slice: SnapshotSlice, clanId: number, payload: unknown | null): Promise<boolean> {
  const { weekStarting, lease, dependencies } = slice
  const read = readProfile(payload, clanId)

  if ('error' in read) {
    await skipGuild(slice, clanId, read.error)

    return false
  }

  const { profile } = read
  const provenance = weeklySnapshotProvenance(successProvenance('profile'))
  const stored = { weekStarting, profile, sourceRank: parseGuildRank(payload), checkedAt: new Date(), provenance }

  requireLease(await dependencies.snapshots.storeGuild(lease, stored))

  return true
}

// a failed guild is only skipped once a later one gets an answer, so the guilds an outage hit are fetched again
async function skipFailedGuilds(slice: SnapshotSlice, progress: SliceProgress): Promise<void> {
  for (const { clanId, error } of progress.failedGuilds) await skipGuild(slice, clanId, error)

  progress.skippedGuilds += progress.failedGuilds.length
  progress.failedGuilds = []
}

// failures at the end of a full slice wait for the next slice to confirm them, unless the slice moved past no guild:
// a slice of nothing but failures would otherwise be fetched again forever. The last slice has no next one
async function skipFailedGuildsAtSliceEnd(
  slice: SnapshotSlice,
  progress: SliceProgress,
  clanIds: number[],
): Promise<void> {
  const isLastSlice = clanIds.length < slice.dependencies.sliceGuilds
  const hasMovedOn = progress.storedGuilds + progress.skippedGuilds > 0

  if (isLastSlice || !hasMovedOn) await skipFailedGuilds(slice, progress)
}

// past the limit only the first guild is skipped, and the run still waits: an outage that outlasts it loses one guild
// per wait, while broken guilds are all skipped once the guild after them answers
async function skipFirstFailedGuild(slice: SnapshotSlice, progress: SliceProgress): Promise<void> {
  const [firstGuild] = progress.failedGuilds

  if (!firstGuild) return

  await skipGuild(slice, firstGuild.clanId, firstGuild.error)
  progress.skippedGuilds += 1
}

async function deferIfSourceDown(slice: SnapshotSlice, progress: SliceProgress): Promise<void> {
  const { failedGuilds } = progress

  if (failedGuilds.length < clanWeeklySnapshotOutageGuilds) return

  const downForMs = requireLease(await slice.dependencies.snapshots.markSourceDown(slice.lease, slice.weekStarting))

  if (downForMs >= clanWeeklySnapshotOutageLimitMs) await skipFirstFailedGuild(slice, progress)

  const lastError = failedGuilds.at(-1)?.error

  throw new ClanWeeklySnapshotSourceDown(slice.weekStarting, failedGuilds.length, lastError)
}

// a guild that answers shows V1 is up, so guilds failing in a row later start their own clock
async function clearSourceDown(slice: SnapshotSlice, progress: SliceProgress): Promise<void> {
  if (!progress.isSourceDown) return

  requireLease(await slice.dependencies.snapshots.clearSourceDown(slice.lease, slice.weekStarting))
  progress.isSourceDown = false
}

async function snapshotGuild(slice: SnapshotSlice, progress: SliceProgress, clanId: number): Promise<void> {
  const fetched = await fetchGuildStats(slice.fetcher, clanId)

  if ('error' in fetched) {
    progress.failedGuilds.push({ clanId, error: fetched.error })
    await deferIfSourceDown(slice, progress)

    return
  }

  await skipFailedGuilds(slice, progress)
  await clearSourceDown(slice, progress)

  if (await saveGuild(slice, clanId, fetched.payload)) progress.storedGuilds += 1
  else progress.skippedGuilds += 1
}

async function snapshotGuilds(slice: SnapshotSlice, clanIds: number[], isSourceDown: boolean): Promise<SliceProgress> {
  const { dependencies, tools } = slice
  const progress: SliceProgress = { storedGuilds: 0, skippedGuilds: 0, failedGuilds: [], isSourceDown }

  for (const [index, clanId] of clanIds.entries()) {
    if (index > 0) await dependencies.waitBetweenGuilds(dependencies.guildDelayMs, tools.signal)

    if (tools.signal.aborted) throw new JobLeaseLostError()

    await snapshotGuild(slice, progress, clanId)
  }

  await skipFailedGuildsAtSliceEnd(slice, progress, clanIds)

  return progress
}

function logSlice(slice: SnapshotSlice, progress: SliceProgress): void {
  try {
    slice.dependencies.telemetry.logger.info('clan.weekly_snapshot.slice', {
      weekStarting: slice.weekStarting,
      storedGuilds: progress.storedGuilds,
      skippedGuilds: progress.skippedGuilds,
    })
  } catch {
    // telemetry never decides the outcome of committed work
  }
}

async function completeOperation(lease: WeeklySnapshotLease, tools: JobTools): Promise<AttemptOutcome> {
  const transition = await tools.queue.complete(lease)

  return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

function createSlice(
  dependencies: ClanWeeklySnapshotJobDependencies,
  lease: WeeklySnapshotLease,
  tools: JobTools,
  weekStarting: string,
): SnapshotSlice {
  // each claim gets its own reservation keys, a deferred attempt keeps its attempt number
  const admitSource = markAdmissionFailures(tools.createSourceAdmitter(`weekly-snapshot:${lease.leaseToken}`))

  const fetcher: GuildStatsFetcher = {
    source: dependencies.createAdmittedSource(admitSource),
    waitBeforeRetry: dependencies.waitBeforeGuildRetry,
    signal: tools.signal,
  }

  return { weekStarting, lease, dependencies, fetcher, tools }
}

// stores one slice of guilds per attempt and resumes after the last stored or skipped guild, so a yield, a failure
// or a lost lease only costs the guilds not yet recorded
async function runWeeklySnapshot(
  dependencies: ClanWeeklySnapshotJobDependencies,
  lease: WeeklySnapshotLease,
  tools: JobTools,
): Promise<AttemptOutcome> {
  const weekStarting = weekStartingOf(lease)
  const run = await dependencies.snapshots.begin(weekStarting)

  if (run.isCompleted) return completeOperation(lease, tools)

  const clanIds = await dependencies.snapshots.listClansAfter(run.lastClanId, dependencies.sliceGuilds)
  const slice = createSlice(dependencies, lease, tools, weekStarting)
  const progress = await snapshotGuilds(slice, clanIds, run.isSourceDown)

  logSlice(slice, progress)

  if (clanIds.length === dependencies.sliceGuilds) throw new ClanWeeklySnapshotYield(weekStarting)

  requireLease(await dependencies.snapshots.complete(lease, weekStarting))

  return completeOperation(lease, tools)
}

export function createClanWeeklySnapshotJob(
  dependencies: ClanWeeklySnapshotJobDependencies,
): JobDefinition<ClanWeeklySnapshotPayload> {
  return defineJob<ClanWeeklySnapshotPayload>({
    ...clanWeeklySnapshotContract,
    failureCode: 'clan_weekly_snapshot_failed',
    decideFailure: async (error) => decideSnapshotFailure(error, dependencies.retryTimings),
    run: (lease, tools) => runWeeklySnapshot(dependencies, lease, tools),
  })
}
