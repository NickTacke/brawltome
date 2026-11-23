import type { JobContract } from '@brawltome/queue'
import { type EsportsPlayerPayload, parseEsportsPlayerPayload } from './player-payload'

export type EsportsRefreshPayload = EsportsPlayerPayload

export const esportsRefreshContract: JobContract<EsportsRefreshPayload> = {
  kind: 'esports-refresh',
  workClasses: ['maintenance'],
  parsePayload: (value) => parseEsportsPlayerPayload(value, 'esports refresh'),
}
