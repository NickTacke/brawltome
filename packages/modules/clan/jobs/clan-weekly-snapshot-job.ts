import {
  type AttemptOutcome,
  type ClanWeeklySnapshotPayload,
  defineJob,
  type FailureDecision,
  type JobDefinition,
  JobLeaseLostError,
  type JobTools,
  type Lease,
  type SourceAdmitter,
} from '@brawltome/queue'
import type { Telemetry } from '@brawltome/telemetry'
import type { PostgresClans } from '../db/postgres-clans'
import type { PostgresWeeklySnapshots } from '../db/postgres-weekly-snapshots'
import { type ClanProfileWrite, parseGuildStats } from '../domain/guild-stats'
import { successProvenance } from '../domain/provenance'
import { clanWeeklySnapshotContract } from './clan-weekly-snapshot-contract'
import type { ClanSource } from './refresh-clan'

export const defaultClanWeeklySnapshotSliceGuilds = 100

export type ClanWeeklySnapshotJobDependencies = {
  clans: Pick<PostgresClans, 'publishProfile'>
  snapshots: PostgresWeeklySnapshots
  // the Brawlhalla client, with every call going through this attempt's admission
  createAdmittedSource(admitSource: SourceAdmitter): Pick<ClanSource, 'getGuildStatsV1'>
  sliceGuilds: number
  guildDelayMs: number
  waitBetweenGuilds(delayMs: number, signal: AbortSignal): Promise<void>
  telemetry: Telemetry
}

type WeeklySnapshotLease = Lease<ClanWeeklySnapshotPayload>

type SnapshotSlice = {
  weekStarting: string
  dependencies: ClanWeeklySnapshotJobDependencies
  source: Pick<ClanSource, 'getGuildStatsV1'>
  tools: JobTools
}

// thrown after a slice so the job gives the maintenance slot back; deferring it spends no attempt
class ClanWeeklySnapshotYield extends Error {
  constructor(weekStarting: string) {
    super(`clan weekly snapshot for week ${weekStarting} yielded between slices`)
  }
}

function weekStartingOf(lease: WeeklySnapshotLease): string {
  const windowAt = new Date(lease.scheduleWindowAt ?? lease.effectCreatedAt)

  return windowAt.toISOString().slice(0, 10)
}

// a 404 can't be told from a hiccup and a payload that doesn't parse won't parse on a retry, so one such guild
// misses this week instead of holding up the others
function readProfile(payload: unknown, clanId: number): ClanProfileWrite | null {
  if (payload === null) return null

  try {
    return parseGuildStats(payload, clanId)
  } catch {
    return null
  }
}

async function snapshotGuild(slice: SnapshotSlice, clanId: number): Promise<boolean> {
  const { weekStarting, dependencies, source } = slice
  const payload = await source.getGuildStatsV1(clanId, { caller: 'background' })
  const profile = readProfile(payload, clanId)

  if (!profile) {
    await dependencies.snapshots.record({ weekStarting, clanId, guildPoints: null })

    return false
  }

  await dependencies.clans.publishProfile(profile, new Date(), successProvenance('profile'))
  await dependencies.snapshots.record({ weekStarting, clanId, guildPoints: profile.guildPoints })

  return true
}

async function snapshotGuilds(slice: SnapshotSlice, clanIds: number[]): Promise<number> {
  const { dependencies, tools } = slice
  let storedGuilds = 0

  for (const [index, clanId] of clanIds.entries()) {
    if (index > 0) await dependencies.waitBetweenGuilds(dependencies.guildDelayMs, tools.signal)

    if (tools.signal.aborted) throw new JobLeaseLostError()

    if (await snapshotGuild(slice, clanId)) storedGuilds += 1
  }

  return storedGuilds
}

function logSlice(slice: SnapshotSlice, guilds: number, storedGuilds: number): void {
  try {
    slice.dependencies.telemetry.logger.info('clan.weekly_snapshot.slice', {
      weekStarting: slice.weekStarting,
      storedGuilds,
      skippedGuilds: guilds - storedGuilds,
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
  const admitSource = tools.createSourceAdmitter(`weekly-snapshot:${lease.leaseToken}`)

  return { weekStarting, dependencies, source: dependencies.createAdmittedSource(admitSource), tools }
}

// stores one slice of guilds per attempt and resumes after the last stored guild, so a yield, a failure or a lost
// lease only costs the guild in flight
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
  const storedGuilds = await snapshotGuilds(slice, clanIds)

  logSlice(slice, clanIds.length, storedGuilds)

  if (clanIds.length === dependencies.sliceGuilds) throw new ClanWeeklySnapshotYield(weekStarting)

  await dependencies.snapshots.complete(weekStarting)

  return completeOperation(lease, tools)
}

// null leaves the error to the dispatcher's source and execution rules
async function decideSnapshotFailure(error: unknown): Promise<FailureDecision | null> {
  if (error instanceof JobLeaseLostError) return { action: 'lease-lost' }

  if (!(error instanceof ClanWeeklySnapshotYield)) return null

  return {
    action: 'defer',
    failure: { code: 'clan_weekly_snapshot_yield', message: error.message, retryable: true },
    delayMs: 0,
    category: 'admission_deferred',
  }
}

export function createClanWeeklySnapshotJob(
  dependencies: ClanWeeklySnapshotJobDependencies,
): JobDefinition<ClanWeeklySnapshotPayload> {
  return defineJob<ClanWeeklySnapshotPayload>({
    ...clanWeeklySnapshotContract,
    failureCode: 'clan_weekly_snapshot_failed',
    decideFailure: decideSnapshotFailure,
    run: (lease, tools) => runWeeklySnapshot(dependencies, lease, tools),
  })
}
