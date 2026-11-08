import type { Database } from '@brawltome/foundation'
import {
  type AcceptOperationResult,
  activateBound,
  listAwaiting,
  type OperationProvenance,
  reserveForBinding,
  type StatisticsCollectionKind,
  type StatisticsCollectionPayload,
  type StatisticsLegendMetaPublicationPayload,
  type StatisticsPublicationPayload,
  statisticsCollectionKinds,
  type TransitionResult,
} from '@brawltome/refresh-operations'

const publicationKinds = ['statistics-publication'] as const
const legendMetaPublicationKinds = ['statistics-legend-meta-publication'] as const

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type StatisticsReservation = {
  dedupeKey: string
  operationKey: string
  workClass: 'global-statistics'
  provenance: OperationProvenance
  maxAttempts?: number
}

export type ReserveStatisticsCollection = StatisticsReservation & {
  kind: StatisticsCollectionKind
  payload: StatisticsCollectionPayload
}

export type ReserveStatisticsPublication = StatisticsReservation & {
  kind: 'statistics-publication'
  payload: StatisticsPublicationPayload
}

export type ReserveStatisticsLegendMetaPublication = StatisticsReservation & {
  kind: 'statistics-legend-meta-publication'
  payload: StatisticsLegendMetaPublicationPayload
}

export interface StatisticsReservations {
  reserveStatisticsCollection(input: ReserveStatisticsCollection): Promise<AcceptOperationResult>
  listAwaitingStatisticsCollections(): Promise<string[]>
  activateStatisticsCollection(operationId: string): Promise<TransitionResult>
  reserveStatisticsPublication(input: ReserveStatisticsPublication): Promise<AcceptOperationResult>
  listAwaitingStatisticsPublications(): Promise<string[]>
  activateStatisticsPublication(operationId: string): Promise<TransitionResult>
  reserveStatisticsLegendMetaPublication(input: ReserveStatisticsLegendMetaPublication): Promise<AcceptOperationResult>
  listAwaitingStatisticsLegendMetaPublications(): Promise<string[]>
  activateStatisticsLegendMetaPublication(operationId: string): Promise<TransitionResult>
}

function reserveStatisticsCollection(
  database: Database,
  input: ReserveStatisticsCollection,
): Promise<AcceptOperationResult> {
  if (input.dedupeKey !== input.operationKey) {
    throw new Error('statistics collection dedupeKey must equal its stable operationKey')
  }

  if (input.workClass !== 'global-statistics') {
    throw new Error('statistics collection requires global-statistics work class')
  }

  if (!uuidPattern.test(input.payload.cohortId)) {
    throw new Error('statistics collection cohortId must be a UUID')
  }

  if (!Number.isSafeInteger(input.payload.brawlhallaId) || input.payload.brawlhallaId <= 0) {
    throw new Error('statistics collection brawlhallaId must be a positive safe integer')
  }

  return reserveForBinding(database, {
    ...input,
    operationKeyKinds: statisticsCollectionKinds,
    lockNamespace: 209,
    mismatchMessage: 'statistics collection operation key has a different definition',
  })
}

function reserveStatisticsPublication(
  database: Database,
  input: ReserveStatisticsPublication,
): Promise<AcceptOperationResult> {
  if (input.dedupeKey !== input.operationKey) {
    throw new Error('statistics publication dedupeKey must equal its stable operationKey')
  }

  if (input.workClass !== 'global-statistics') {
    throw new Error('statistics publication requires global-statistics work class')
  }

  if (!uuidPattern.test(input.payload.generationId)) {
    throw new Error('statistics publication generationId must be a UUID')
  }

  if (input.payload.product !== 'ranked' && input.payload.product !== 'lifetime') {
    throw new Error('statistics publication product is unsupported')
  }

  return reserveForBinding(database, {
    ...input,
    lockNamespace: 210,
    mismatchMessage: 'statistics publication operation key has a different definition',
  })
}

function reserveStatisticsLegendMetaPublication(
  database: Database,
  input: ReserveStatisticsLegendMetaPublication,
): Promise<AcceptOperationResult> {
  if (input.dedupeKey !== input.operationKey) {
    throw new Error('Statistics Legend Meta publication dedupeKey must equal its stable operationKey')
  }

  if (input.workClass !== 'global-statistics') {
    throw new Error('Statistics Legend Meta publication requires global-statistics work class')
  }

  if (!uuidPattern.test(input.payload.generationId)) {
    throw new Error('Statistics Legend Meta publication generationId must be a UUID')
  }

  return reserveForBinding(database, {
    ...input,
    lockNamespace: 211,
    mismatchMessage: 'Statistics Legend Meta operation key has a different definition',
  })
}

export function createStatisticsReservations(database: Database): StatisticsReservations {
  return {
    reserveStatisticsCollection: async (input) => reserveStatisticsCollection(database, input),

    listAwaitingStatisticsCollections: () =>
      listAwaiting(database, { kinds: statisticsCollectionKinds, status: 'awaiting_binding', limit: 500 }),

    activateStatisticsCollection: (operationId) =>
      activateBound(database, operationId, { kinds: statisticsCollectionKinds }),

    reserveStatisticsPublication: async (input) => reserveStatisticsPublication(database, input),

    listAwaitingStatisticsPublications: () =>
      listAwaiting(database, { kinds: publicationKinds, status: 'awaiting_binding', limit: 100 }),

    activateStatisticsPublication: (operationId) => activateBound(database, operationId, { kinds: publicationKinds }),

    reserveStatisticsLegendMetaPublication: async (input) => reserveStatisticsLegendMetaPublication(database, input),

    listAwaitingStatisticsLegendMetaPublications: () =>
      listAwaiting(database, { kinds: legendMetaPublicationKinds, status: 'awaiting_binding', limit: 100 }),

    activateStatisticsLegendMetaPublication: (operationId) =>
      activateBound(database, operationId, { kinds: legendMetaPublicationKinds }),
  }
}
