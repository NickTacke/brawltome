import {
  type BoardMode,
  type BoardRegion,
  defaultMode,
  defaultRegion,
  parseMode,
  parseRegion,
} from '../home/home-filters'

export type QueueSearch = { mode?: BoardMode; region?: BoardRegion; page?: number }
export type QueueQuery = { mode: BoardMode; region: BoardRegion; page: number }

// the api serves 500 pages at most
const lastPage = 500

function parsePage(value: unknown): number | undefined {
  const isPage = typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= lastPage

  return isPage ? value : undefined
}

function withoutDefault<T>(value: T | undefined, fallback: T): T | undefined {
  return value === fallback ? undefined : value
}

// the defaults stay out of the address, so a bare /queue is the global 1v1 board
export function validateQueueSearch(search: Record<string, unknown>): QueueSearch {
  return {
    mode: withoutDefault(parseMode(search.mode), defaultMode),
    region: withoutDefault(parseRegion(search.region), defaultRegion),
    page: withoutDefault(parsePage(search.page), 1),
  }
}

export function queueQuery(search: QueueSearch): QueueQuery {
  return { mode: search.mode ?? defaultMode, region: search.region ?? defaultRegion, page: search.page ?? 1 }
}
