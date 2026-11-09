import { isPositiveInteger, isSectionList, type JobContract, readPayloadObject } from '@brawltome/queue'
import { type ClanRefreshSection, clanRefreshSections } from '../domain/refresh-section'

export type ClanRefreshPayload = {
  clanId: number
  staleSections: ClanRefreshSection[]
}

function parseClanRefreshPayload(value: unknown): ClanRefreshPayload {
  const payload = readPayloadObject(value, 'clan refresh')

  if (!isPositiveInteger(payload.clanId)) throw new Error('clan refresh clanId must be a positive integer')

  if (!isSectionList(payload.staleSections, clanRefreshSections)) {
    throw new Error('clan refresh staleSections must list profile or roster')
  }

  return value as ClanRefreshPayload
}

export const clanRefreshContract: JobContract<ClanRefreshPayload> = {
  kind: 'clan-refresh',
  workClasses: ['interactive'],
  parsePayload: parseClanRefreshPayload,
}
