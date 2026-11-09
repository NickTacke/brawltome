import {
  hasOnlyFields,
  isPositiveInteger,
  type JobContract,
  readPayloadObject,
  type StatisticsCollectionKind,
  type StatisticsCollectionPayload,
  type StatisticsLegendMetaPublicationPayload,
  type StatisticsPublicationPayload,
} from '@brawltome/queue'

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: unknown): boolean {
  return typeof value === 'string' && uuidPattern.test(value)
}

function parseCollectionPayload(value: unknown): StatisticsCollectionPayload {
  const payload = readPayloadObject(value, 'statistics collection')

  if (!isUuid(payload.cohortId)) throw new Error('statistics collection cohortId must be a UUID')

  if (!isPositiveInteger(payload.brawlhallaId)) {
    throw new Error('statistics collection brawlhallaId must be a positive safe integer')
  }

  return value as StatisticsCollectionPayload
}

export function statisticsCollectionContract(kind: StatisticsCollectionKind): JobContract<StatisticsCollectionPayload> {
  return { kind, workClasses: ['global-statistics'], parsePayload: parseCollectionPayload }
}

function parsePublicationPayload(value: unknown): StatisticsPublicationPayload {
  const payload = readPayloadObject(value, 'statistics publication')

  if (!isUuid(payload.generationId)) throw new Error('statistics publication generationId must be a UUID')

  if (payload.product !== 'ranked' && payload.product !== 'lifetime') {
    throw new Error('statistics publication product is unsupported')
  }

  if (!hasOnlyFields(payload, ['generationId', 'product'])) {
    throw new Error('statistics publication payload has unexpected fields')
  }

  return value as StatisticsPublicationPayload
}

export const statisticsPublicationContract: JobContract<StatisticsPublicationPayload> = {
  kind: 'statistics-publication',
  workClasses: ['global-statistics'],
  parsePayload: parsePublicationPayload,
}

function parseLegendMetaPublicationPayload(value: unknown): StatisticsLegendMetaPublicationPayload {
  const payload = readPayloadObject(value, 'Statistics Legend Meta publication')

  if (!isUuid(payload.generationId)) throw new Error('Statistics Legend Meta publication generationId must be a UUID')

  if (!hasOnlyFields(payload, ['generationId'])) {
    throw new Error('Statistics Legend Meta publication payload has unexpected fields')
  }

  return value as StatisticsLegendMetaPublicationPayload
}

export const statisticsLegendMetaPublicationContract: JobContract<StatisticsLegendMetaPublicationPayload> = {
  kind: 'statistics-legend-meta-publication',
  workClasses: ['global-statistics'],
  parsePayload: parseLegendMetaPublicationPayload,
}
