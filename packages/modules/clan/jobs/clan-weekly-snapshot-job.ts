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
import type { PostgresClans } from '../db/postgres-clans'
import type { PostgresWeeklySnapshots } from '../db/postgres-weekly-snapshots'
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

export type ClanWeeklySnapshotJobDependencies = {
  clans: Pick<PostgresClans, 'publishProfile' | 'recordProfileCheck'>
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
  dependencies: ClanWeeklySnapshotJobDependencies
  fetcher: GuildStatsFetcher
  tools: JobTools
}

type FailedGuild = { clanId: number; error: unknown }

type SliceProgress = { storedGuilds: number; skippedGuilds: number; failedGuilds: FailedGuild[] }

function weekStartingOf(lease: WeeklySnapshotLease): string {
  const windowAt = new Date(lease.scheduleWindowAt ?? lease.effectCreatedAt)

  return windowAt.toISOString().slice(0, 10)
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
  const { weekStarting, dependencies } = slice
  const provenance = weeklySnapshotProvenance(failedCheckProvenance('profile', classifySourceFailure(error)))

  await dependencies.clans.recordProfileCheck(clanId, new Date(), provenance)
  await dependencies.snapshots.record({ weekStarting, clanId, guildPoints: null, sourceRank: null })
}

async function saveGuild(slice: SnapshotSlice, clanId: number, payload: unknown | null): Promise<boolean> {
  const { weekStarting, dependencies } = slice
  const read = readProfile(payload, clanId)

  if ('error' in read) {
    await skipGuild(slice, clanId, read.error)

    return false
  }

  const { profile } = read
  const provenance = weeklySnapshotProvenance(successProvenance('profile'))
  const sourceRank = parseGuildRank(payload)

  await dependencies.clans.publishProfile(profile, new Date(), provenance)
  await dependencies.snapshots.record({ weekStarting, clanId, guildPoints: profile.guildPoints, sourceRank })

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

function throwIfSourceDown(slice: SnapshotSlice, progress: SliceProgress): void {
  const { failedGuilds } = progress

  if (failedGuilds.length < clanWeeklySnapshotOutageGuilds) return

  const lastError = failedGuilds.at(-1)?.error

  throw new ClanWeeklySnapshotSourceDown(slice.weekStarting, failedGuilds.length, lastError)
}

async function snapshotGuild(slice: SnapshotSlice, progress: SliceProgress, clanId: number): Promise<void> {
  const fetched = await fetchGuildStats(slice.fetcher, clanId)

  if ('error' in fetched) {
    progress.failedGuilds.push({ clanId, error: fetched.error })
    throwIfSourceDown(slice, progress)

    return
  }

  await skipFailedGuilds(slice, progress)

  if (await saveGuild(slice, clanId, fetched.payload)) progress.storedGuilds += 1
  else progress.skippedGuilds += 1
}

async function snapshotGuilds(slice: SnapshotSlice, clanIds: number[]): Promise<SliceProgress> {
  const { dependencies, tools } = slice
  const progress: SliceProgress = { storedGuilds: 0, skippedGuilds: 0, failedGuilds: [] }

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

  return { weekStarting, dependencies, fetcher, tools }
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
  const progress = await snapshotGuilds(slice, clanIds)

  logSlice(slice, progress)

  if (clanIds.length === dependencies.sliceGuilds) throw new ClanWeeklySnapshotYield(weekStarting)

  await dependencies.snapshots.complete(weekStarting)

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
