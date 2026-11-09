import {
  hasOnlyFields,
  isPositive32BitInteger,
  type JobContract,
  readPayloadObject,
} from '@brawltome/refresh-operations'

export type PlayerNameVerificationPayload = { brawlhallaId: number; playerName: string }

function parsePlayerNameVerificationPayload(value: unknown): PlayerNameVerificationPayload {
  const payload = readPayloadObject(value, 'player name verification')

  if (!isPositive32BitInteger(payload.brawlhallaId)) {
    throw new Error('player name verification brawlhallaId must be a positive 32-bit integer')
  }

  if (typeof payload.playerName !== 'string' || payload.playerName.length === 0) {
    throw new Error('player name verification playerName must be a non-empty string')
  }

  if (!hasOnlyFields(payload, ['brawlhallaId', 'playerName'])) {
    throw new Error('player name verification payload has unexpected fields')
  }

  return value as PlayerNameVerificationPayload
}

export const playerNameVerificationContract: JobContract<PlayerNameVerificationPayload> = {
  kind: 'player-name-verification',
  workClasses: ['maintenance'],
  parsePayload: parsePlayerNameVerificationPayload,
}
