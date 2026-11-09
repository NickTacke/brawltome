import { isPositive32BitInteger, type JobContract, readPayloadObject } from '@brawltome/queue'

export type RankedPlayerPulsePayload = { brawlhallaId: number }

function parseRankedPlayerPulsePayload(value: unknown): RankedPlayerPulsePayload {
  const payload = readPayloadObject(value, 'ranked player pulse')

  if (!isPositive32BitInteger(payload.brawlhallaId)) {
    throw new Error('ranked player pulse brawlhallaId must be a positive 32-bit integer')
  }

  // a payload with sections is a player refresh that was filed under the wrong kind
  if (Object.hasOwn(payload, 'staleSections')) throw new Error('ranked player pulse payload has unexpected fields')

  return value as RankedPlayerPulsePayload
}

export const rankedPlayerPulseContract: JobContract<RankedPlayerPulsePayload> = {
  kind: 'ranked-player-pulse',
  workClasses: ['primary-monitoring'],
  parsePayload: parseRankedPlayerPulsePayload,
}
