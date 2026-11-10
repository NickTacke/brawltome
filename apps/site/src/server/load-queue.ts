import {
  type LeaderboardRecentActivityOutput,
  type LeaderboardRecentMoversOutput,
  leaderboardRecentActivityOutputSchema,
  leaderboardRecentMoversOutputSchema,
} from '@brawltome/contracts'
import type { QueueQuery } from '../components/queue/queue-search'
import { readApi } from './api'
import { optionalRead, readOptional } from './optional-read'

export type QueueMovers = Extract<LeaderboardRecentMoversOutput, { status: 'available' }>

export type QueuePage = { view: LeaderboardRecentActivityOutput; movers: QueueMovers | null }

function readActivity({ mode, region, page }: QueueQuery): Promise<LeaderboardRecentActivityOutput> {
  const path = `/leaderboards/${mode}/${region}/recent-activity?page=${page}`
  const description = `load the queue for ${mode} ${region} page ${page}`

  return readApi(path, leaderboardRecentActivityOutputSchema, description)
}

async function readMovers({ mode, region }: QueueQuery): Promise<QueueMovers | null> {
  const path = `/leaderboards/${mode}/${region}/recent-movers`
  const description = `load the queue movers for ${mode} ${region}`
  const movers = await readApi(path, leaderboardRecentMoversOutputSchema, description, optionalRead)

  return movers.status === 'available' ? movers : null
}

/** One page of the last hour and its movers. The movers only decorate the page, so a failed read leaves them out. */
export async function loadQueue(query: QueueQuery): Promise<QueuePage> {
  const [view, movers] = await Promise.all([readActivity(query), readOptional(() => readMovers(query), null)])

  // the two reads each take the latest scan, and one can publish in between
  const isSameScan = view.status !== 'unavailable' && movers?.currentSnapshotId === view.currentSnapshotId

  return { view, movers: isSameScan ? movers : null }
}
