import { hasOnlyFields, type JobContract, readPayloadObject } from '@brawltome/refresh-operations'
import type { ProjectionOwner } from '../model'

export type ReconciliationPayload = { owner: ProjectionOwner }

function parseReconciliationPayload(value: unknown): ReconciliationPayload {
  const payload = readPayloadObject(value, 'discovery reconciliation')

  if (payload.owner !== 'player' && payload.owner !== 'clan') {
    throw new Error('discovery reconciliation owner is invalid')
  }

  if (!hasOnlyFields(payload, ['owner'])) throw new Error('discovery reconciliation payload has unexpected fields')

  return value as ReconciliationPayload
}

export const discoveryReconciliationContract: JobContract<ReconciliationPayload> = {
  kind: 'discovery-reconciliation',
  workClasses: ['projection'],
  parsePayload: parseReconciliationPayload,
}
