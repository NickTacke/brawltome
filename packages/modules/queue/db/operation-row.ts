import type { OperationLease, WorkClass } from '../model'

export type OperationRow = {
  id: string
  effect_operation_id: string
  effect_created_at: string
  kind: string
  operation_key: string
  work_class: WorkClass
  payload: unknown
  provenance: { source: string; requestedBy?: string }
  lease_owner: string
  lease_token: string | number
  attempt_count: number
  max_attempts: number
  status: string
  scheduled_window_at: Date | null
}

// claim has already run this row through its job's parsePayload, which is what makes the kind and payload belong together
export function toLease(row: OperationRow): OperationLease {
  return {
    operationId: row.id,
    effectOperationId: row.effect_operation_id,
    effectCreatedAt: row.effect_created_at,
    operationKey: row.operation_key,
    provenance: row.provenance,
    leaseOwner: row.lease_owner,
    leaseToken: Number(row.lease_token),
    attemptNumber: row.attempt_count,
    maxAttempts: row.max_attempts,
    scheduleWindowAt: row.scheduled_window_at?.toISOString() ?? null,
    kind: row.kind,
    workClass: row.work_class,
    payload: row.payload,
  } as OperationLease
}
