import {
  type AttemptOutcome,
  defineJob,
  type JobDefinition,
  type JobTools,
  type LeaderboardDeepCrawlMode,
  type LeaderboardDeepCrawlPayload,
  type Lease,
  type RetryTimings,
} from '@brawltome/refresh-operations'
import type { Telemetry } from '@brawltome/telemetry'
import {
  type LeaderboardDeepCrawlStanding,
  type LeaderboardDeepCrawlTeam,
  LeaderboardLeaseLostError,
  type LeaderboardPageSource,
  leaderboardDeepCrawlStandings,
  leaderboardDeepCrawlTeams,
} from '../leaderboard'
import { LeaderboardSourceError } from '../v1-leaderboard-source'
import { type AdmittedPageFetchDependencies, createAdmittedPageFetch } from './admitted-page-fetch'
import { decideLeaderboardFailure, LeaderboardDeepCrawlYield } from './leaderboard-failure'
import { recordLeaderboardTelemetry } from './leaderboard-telemetry'
import type {
  LeaderboardPlayerNames,
  LeaderboardPlayerStanding,
  LeaderboardRankedStandings,
} from './player-propagation'

export const defaultDeepCrawlSlicePages = 100

const deepCrawlChunkPages = 20

export type DeepCrawlProgress = { windowAt: Date; nextPage: number; totalPages: number }

export type LeaderboardDeepCrawlJobDependencies = AdmittedPageFetchDependencies & {
  playerNames: LeaderboardPlayerNames
  rankedStandings: LeaderboardRankedStandings
  teamModes: {
    applyLeaderboardSoloQueue(input: {
      observedAt: Date
      players: LeaderboardPlayerStanding[]
    }): Promise<{ changed: number }>
    applyLeaderboardTeams(input: { observedAt: Date; teams: LeaderboardDeepCrawlTeam[] }): Promise<{ changed: number }>
  }
  progress: {
    read(mode: string, region: string): Promise<DeepCrawlProgress | null>
    save(input: DeepCrawlProgress & { mode: string; region: string }): Promise<void>
  }
  slicePages: number
  pageDelayMs: number
  retryTimings: RetryTimings
}

type LeaderboardDeepCrawlLease = Lease<LeaderboardDeepCrawlPayload>

type DeepCrawl = {
  mode: LeaderboardDeepCrawlMode
  region: LeaderboardDeepCrawlPayload['region']
  windowAt: Date
  startedAt: number
  fetchPage: LeaderboardPageSource['fetchPage']
  page: number
  totalPages: number
  chunk: LeaderboardDeepCrawlStanding[]
  teamChunk: LeaderboardDeepCrawlTeam[]
  chunkObservedAt: Date
  changedNames: number
  changedStandings: number
  pagesRead: number
  pagesSkipped: number
}

type ChangeKind = 'name' | 'standing' | 'solo' | 'team'

function recordChanged(crawl: DeepCrawl, telemetry: Telemetry, change: ChangeKind, count: number): void {
  const { mode, region } = crawl

  recordLeaderboardTelemetry(telemetry, (active) =>
    active.metrics.add('leaderboard_deep_crawl_changed_total', count, { mode, region, change }),
  )
}

function recordPage(crawl: DeepCrawl, telemetry: Telemetry, outcome: 'read' | 'skipped'): void {
  const { mode, region } = crawl

  recordLeaderboardTelemetry(telemetry, (active) =>
    active.metrics.add('leaderboard_deep_crawl_pages_total', 1, { mode, region, outcome }),
  )
}

function logOutcome(crawl: DeepCrawl, telemetry: Telemetry, outcome: 'completed' | 'yielded'): void {
  recordLeaderboardTelemetry(telemetry, (active) =>
    active.logger.info(`leaderboard.deep_crawl.${outcome}`, {
      mode: crawl.mode,
      region: crawl.region,
      nextPage: crawl.page,
      totalPages: crawl.totalPages,
      pagesRead: crawl.pagesRead,
      pagesSkipped: crawl.pagesSkipped,
      changedNames: crawl.changedNames,
      changedStandings: crawl.changedStandings,
      durationMs: Math.round(performance.now() - crawl.startedAt),
    }),
  )
}

// standings without the display name, which only the names write uses
function standingsOnly(chunk: LeaderboardDeepCrawlStanding[]): LeaderboardPlayerStanding[] {
  return chunk.map(({ name: _name, ...standing }) => standing)
}

async function writeOneVsOneChunk(crawl: DeepCrawl, dependencies: LeaderboardDeepCrawlJobDependencies): Promise<void> {
  const names = await dependencies.playerNames.applyLeaderboardNames({
    observedAt: crawl.chunkObservedAt,
    players: crawl.chunk.map(({ brawlhallaId, name }) => ({ brawlhallaId, name })),
  })

  const standings = await dependencies.rankedStandings.applyLeaderboardRanked({
    observedAt: crawl.chunkObservedAt,
    players: standingsOnly(crawl.chunk),
  })

  crawl.changedNames += names.changed
  crawl.changedStandings += standings.changed
  recordChanged(crawl, dependencies.telemetry, 'name', names.changed)
  recordChanged(crawl, dependencies.telemetry, 'standing', standings.changed)
}

// solo 2v2 names are as cached as 2v2 ones, only the numbers are kept
async function writeSoloChunk(crawl: DeepCrawl, dependencies: LeaderboardDeepCrawlJobDependencies): Promise<void> {
  const solo = await dependencies.teamModes.applyLeaderboardSoloQueue({
    observedAt: crawl.chunkObservedAt,
    players: standingsOnly(crawl.chunk),
  })

  crawl.changedStandings += solo.changed
  recordChanged(crawl, dependencies.telemetry, 'solo', solo.changed)
}

async function writeTeamChunk(crawl: DeepCrawl, dependencies: LeaderboardDeepCrawlJobDependencies): Promise<void> {
  const teams = await dependencies.teamModes.applyLeaderboardTeams({
    observedAt: crawl.chunkObservedAt,
    teams: crawl.teamChunk,
  })

  crawl.changedStandings += teams.changed
  recordChanged(crawl, dependencies.telemetry, 'team', teams.changed)
}

async function writeChunk(crawl: DeepCrawl, dependencies: LeaderboardDeepCrawlJobDependencies): Promise<void> {
  if (crawl.chunk.length > 0 && crawl.mode === '1v1') return writeOneVsOneChunk(crawl, dependencies)

  if (crawl.chunk.length > 0 && crawl.mode === 'solo2v2') return writeSoloChunk(crawl, dependencies)

  if (crawl.teamChunk.length > 0) return writeTeamChunk(crawl, dependencies)
}

async function flushChunk(crawl: DeepCrawl, dependencies: LeaderboardDeepCrawlJobDependencies): Promise<void> {
  await writeChunk(crawl, dependencies)

  crawl.chunk = []
  crawl.teamChunk = []

  await dependencies.progress.save({
    mode: crawl.mode,
    region: crawl.region,
    windowAt: crawl.windowAt,
    nextPage: crawl.page,
    totalPages: crawl.totalPages,
  })
}

type DeepCrawlPage = Awaited<ReturnType<LeaderboardPageSource['fetchPage']>>
type PageFetchResult = DeepCrawlPage | 'skipped' | 'ended'

// deep pages are never read by the regular collections: one bad page must not cost the whole region, and a
// leaderboard that shrank while the crawl ran simply ends it; a failure on page 1 still fails the attempt
async function fetchCrawlPage(crawl: DeepCrawl): Promise<PageFetchResult> {
  try {
    return await crawl.fetchPage({ mode: crawl.mode, region: crawl.region, page: crawl.page })
  } catch (error) {
    if (!(error instanceof LeaderboardSourceError) || error.code !== 'source_contract_invalid' || crawl.page === 1) {
      throw error
    }

    return /exceeds total_pages/.test(error.message) ? 'ended' : 'skipped'
  }
}

function addPageToChunk(crawl: DeepCrawl, page: DeepCrawlPage): void {
  if (crawl.mode === '2v2') {
    crawl.teamChunk.push(...leaderboardDeepCrawlTeams(page))

    return
  }

  crawl.chunk.push(...leaderboardDeepCrawlStandings(page))
}

// flushes a finished chunk and gives the slot back once the slice is used up, the next attempt resumes from the save
async function settleChunk(crawl: DeepCrawl, dependencies: LeaderboardDeepCrawlJobDependencies): Promise<void> {
  if (crawl.pagesRead % deepCrawlChunkPages !== 0) return

  await flushChunk(crawl, dependencies)

  if (crawl.pagesRead < dependencies.slicePages || crawl.page > crawl.totalPages) return

  logOutcome(crawl, dependencies.telemetry, 'yielded')

  throw new LeaderboardDeepCrawlYield()
}

async function readCrawlPages(
  crawl: DeepCrawl,
  dependencies: LeaderboardDeepCrawlJobDependencies,
  tools: JobTools,
): Promise<void> {
  while (crawl.page <= crawl.totalPages) {
    if (tools.signal.aborted) throw new LeaderboardLeaseLostError()

    if (crawl.chunk.length === 0 && crawl.teamChunk.length === 0) crawl.chunkObservedAt = new Date()

    const fetched = await fetchCrawlPage(crawl)

    if (fetched === 'ended') return

    if (fetched === 'skipped') {
      crawl.pagesSkipped += 1
      recordPage(crawl, dependencies.telemetry, 'skipped')
      crawl.page += 1
      continue
    }

    if (crawl.page === 1) crawl.totalPages = fetched.totalPages

    if (fetched.rankings.length === 0) return

    crawl.pagesRead += 1
    recordPage(crawl, dependencies.telemetry, 'read')
    addPageToChunk(crawl, fetched)

    crawl.page += 1

    if (dependencies.pageDelayMs && crawl.page <= crawl.totalPages) {
      await dependencies.waitForSourceRetry(dependencies.pageDelayMs, tools.signal)
    }

    await settleChunk(crawl, dependencies)
  }
}

async function startCrawl(
  lease: LeaderboardDeepCrawlLease,
  dependencies: LeaderboardDeepCrawlJobDependencies,
  tools: JobTools,
): Promise<DeepCrawl> {
  const startedAt = performance.now()
  const mode = lease.payload.mode ?? '1v1'
  const { region } = lease.payload
  const windowAt = new Date(lease.scheduleWindowAt ?? lease.effectCreatedAt)
  const saved = await dependencies.progress.read(mode, region)
  const isResuming = saved !== null && saved.windowAt.getTime() === windowAt.getTime()

  return {
    mode,
    region,
    windowAt,
    startedAt,
    fetchPage: createAdmittedPageFetch(lease, tools, dependencies),
    page: isResuming ? saved.nextPage : 1,
    totalPages: isResuming ? saved.totalPages : 1,
    chunk: [],
    teamChunk: [],
    chunkObservedAt: new Date(),
    changedNames: 0,
    changedStandings: 0,
    pagesRead: 0,
    pagesSkipped: 0,
  }
}

// reads every V1 leaderboard page of one mode and region in slices, writing each chunk of pages straight to Players
// without publishing a ranking generation; progress is saved per chunk so a yielded, failed or interrupted crawl
// resumes
async function runDeepCrawl(
  lease: LeaderboardDeepCrawlLease,
  dependencies: LeaderboardDeepCrawlJobDependencies,
  tools: JobTools,
): Promise<AttemptOutcome> {
  const crawl = await startCrawl(lease, dependencies, tools)

  await readCrawlPages(crawl, dependencies, tools)

  crawl.page = crawl.totalPages + 1
  await flushChunk(crawl, dependencies)
  logOutcome(crawl, dependencies.telemetry, 'completed')

  const transition = await tools.queue.complete(lease)

  return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

export function createLeaderboardDeepCrawlJob(
  dependencies: LeaderboardDeepCrawlJobDependencies,
): JobDefinition<LeaderboardDeepCrawlPayload> {
  return defineJob<LeaderboardDeepCrawlPayload>({
    kind: 'leaderboard-deep-crawl',
    workClasses: ['leaderboard'],
    failureCode: 'leaderboard_deep_crawl_failed',
    // claim already shapes this payload
    parsePayload: (value) => value as LeaderboardDeepCrawlPayload,
    decideFailure: async (error) => decideLeaderboardFailure(error, dependencies.retryTimings),
    run: (lease, tools) => runDeepCrawl(lease, dependencies, tools),
  })
}
