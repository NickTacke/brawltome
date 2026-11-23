import type { JobContract } from '@brawltome/queue'
import { type EsportsPlayerPayload, parseEsportsPlayerPayload } from './player-payload'

export type EsportsSetsBackfillPayload = EsportsPlayerPayload

export const esportsSetsBackfillContract: JobContract<EsportsSetsBackfillPayload> = {
  kind: 'esports-sets-backfill',
  workClasses: ['maintenance'],
  parsePayload: (value) => parseEsportsPlayerPayload(value, 'esports sets backfill'),
}
