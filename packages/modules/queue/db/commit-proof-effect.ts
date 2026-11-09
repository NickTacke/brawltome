import type { Database } from '@brawltome/foundation'
import type { ProofEffectStore } from '../jobs/complete-with-proof-effect'
import type { Lease } from '../jobs/job-definition'
import type { FencedResult } from '../model'

export async function commitProofEffect(
  database: Database,
  lease: Lease<{ value: string }>,
  proofEffects: ProofEffectStore | undefined,
): Promise<FencedResult> {
  const client = database.sql

  if (lease.kind !== 'proof' && lease.kind !== 'primary-player-verification') {
    throw new Error('commitProofEffect requires a proof operation')
  }

  if (!proofEffects) {
    throw new Error(`commit proof effect for operation ${lease.operationId}: no proof effect writer was configured`)
  }

  return client.begin(async (transaction) => {
    const sql = transaction as unknown as typeof client

    const [owned] = await sql<
      {
        id: string
        effect_operation_id: string
        operation_key: string
        payload: { value: string }
      }[]
    >`
      SELECT id, effect_operation_id, operation_key, payload FROM refresh_operations.operations
      WHERE id = ${lease.operationId} AND kind = ${lease.kind} AND status = 'leased'
        AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp()
      FOR UPDATE
    `

    if (!owned) return 'lease-lost' as const

    return proofEffects.write(sql, {
      operationKey: owned.operation_key,
      effectOperationId: owned.effect_operation_id,
      leaseToken: lease.leaseToken,
      payload: owned.payload,
    })
  })
}
