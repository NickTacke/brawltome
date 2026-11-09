import {
  isPositiveInteger,
  isSectionList,
  type JobContract,
  readPayloadObject,
  recentlyViewedCohort,
  type WorkClass,
} from '@brawltome/refresh-operations'

export type PlayerRefreshSection = 'ranked' | 'stats'

export type InteractivePlayerRefreshPayload = {
  brawlhallaId: number
  staleSections: PlayerRefreshSection[]
  // set on an account's Primary refresh; such a refresh stops once its assignment ends
  assignmentId?: string
  cohort?: string
}

const playerRefreshSections: readonly PlayerRefreshSection[] = ['ranked', 'stats']

function assertMonitoringPayload(payload: Record<string, unknown>): void {
  const [firstSection, secondSection] = payload.staleSections as string[]

  if (firstSection !== 'ranked' || secondSection !== 'stats') {
    throw new Error('primary monitoring refresh must cover ranked and stats, in that order')
  }

  if (typeof payload.assignmentId === 'string') return

  if (payload.cohort === recentlyViewedCohort && !Object.hasOwn(payload, 'assignmentId')) return

  throw new Error('primary monitoring refresh needs an assignmentId or the recently viewed cohort')
}

function parseInteractivePlayerRefreshPayload(value: unknown, workClass: WorkClass): InteractivePlayerRefreshPayload {
  const payload = readPayloadObject(value, 'player refresh')

  if (!isPositiveInteger(payload.brawlhallaId))
    throw new Error('player refresh brawlhallaId must be a positive integer')

  if (!isSectionList(payload.staleSections, playerRefreshSections)) {
    throw new Error('player refresh staleSections must list ranked or stats')
  }

  if (workClass === 'primary-monitoring') assertMonitoringPayload(payload)

  return value as InteractivePlayerRefreshPayload
}

export const interactivePlayerRefreshContract: JobContract<InteractivePlayerRefreshPayload> = {
  kind: 'interactive-player-refresh',
  workClasses: ['interactive', 'primary-monitoring'],
  parsePayload: parseInteractivePlayerRefreshPayload,
}
