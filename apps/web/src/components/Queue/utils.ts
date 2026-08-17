import { buildQueryString, parseEnum, parseInteger } from '@/lib/searchParams'
import {
  BRACKETS,
  BRACKET_IDS,
  type BracketId,
  MAX_PAGE,
  PAGE_SIZE,
  REGIONS,
  REGION_IDS,
  type RegionId,
  playerHref,
} from '../Leaderboard/utils'

export { BRACKETS, MAX_PAGE, PAGE_SIZE, REGIONS, playerHref }

export type QueueSearchParams = Record<string, string | string[] | undefined>

export interface QueueFilters {
  mode: BracketId
  region: RegionId
  page: number
  snapshotId?: string
}

export type QueuePreference = Pick<QueueFilters, 'mode' | 'region'>

export const QUEUE_PREFERENCE_COOKIE = 'brawltome-queue'
const defaultQueuePreference: QueuePreference = { mode: '1v1', region: 'all' }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function scalar(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null
}

export function parseQueueSearchParams(
  params: QueueSearchParams,
  defaults: QueuePreference = defaultQueuePreference,
): QueueFilters {
  const snapshotId = scalar(params.snapshotId)
  return {
    mode: parseEnum(scalar(params.mode), BRACKET_IDS, defaults.mode),
    region: parseEnum(scalar(params.region), REGION_IDS, defaults.region),
    page: parseInteger(scalar(params.page), { min: 1, max: MAX_PAGE, default: 1 }),
    snapshotId: snapshotId && uuidPattern.test(snapshotId) ? snapshotId : undefined,
  }
}

export function parseQueuePreference(value: string | undefined): QueuePreference | undefined {
  const [version, rawMode, rawRegion, extra] = value?.split('.') ?? []
  const mode = BRACKET_IDS.find((candidate) => candidate === rawMode)
  const region = REGION_IDS.find((candidate) => candidate === rawRegion)
  return version === 'v1' && mode && region && extra === undefined ? { mode, region } : undefined
}

export function queuePreferenceValue({ mode, region }: QueuePreference): string {
  return `v1.${mode}.${region}`
}

export function buildQueueFilterQueryString(filters: QueueFilters): string {
  return buildQueryString({ mode: filters.mode, region: filters.region, page: filters.page })
}

export function buildQueuePageQueryString(filters: QueueFilters, page: number, snapshotId: string): string {
  return buildQueryString({ mode: filters.mode, region: filters.region, page, snapshotId })
}

export function formatSignedDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}
