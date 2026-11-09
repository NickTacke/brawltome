import { isPositiveInteger, type JobContract, readPayloadObject } from '@brawltome/queue'

export type ProjectionPayload = { batchSize: number }

const maxBatchSize = 1_000

function parseProjectionPayload(value: unknown): ProjectionPayload {
  const { batchSize } = readPayloadObject(value, 'discovery projection')

  if (!isPositiveInteger(batchSize) || batchSize > maxBatchSize) {
    throw new Error(`discovery projection batchSize must be between 1 and ${maxBatchSize}`)
  }

  return value as ProjectionPayload
}

function projectionContract(kind: string): JobContract<ProjectionPayload> {
  return { kind, workClasses: ['projection'], parsePayload: parseProjectionPayload }
}

export const playerDiscoveryProjectionContract = projectionContract('player-discovery-projection')

export const clanDiscoveryProjectionContract = projectionContract('clan-discovery-projection')
