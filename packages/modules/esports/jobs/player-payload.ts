import { hasOnlyFields, isPositive32BitInteger, readPayloadObject } from '@brawltome/queue'

// both esports jobs work on one player
export type EsportsPlayerPayload = { brawlhallaId: number }

export function parseEsportsPlayerPayload(value: unknown, jobName: string): EsportsPlayerPayload {
  const payload = readPayloadObject(value, jobName)

  if (!isPositive32BitInteger(payload.brawlhallaId)) {
    throw new Error(`${jobName} brawlhallaId must be a positive 32-bit integer`)
  }

  if (!hasOnlyFields(payload, ['brawlhallaId'])) throw new Error(`${jobName} payload has unexpected fields`)

  return value as EsportsPlayerPayload
}
