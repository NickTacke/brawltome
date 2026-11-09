import type { Database } from '@brawltome/foundation'
import type { Lease } from '../jobs/job-definition'
import type { LeaseAuthorityResult, RenewResult } from '../model'

/** Extends a lease the worker still holds. Run on the renewals pool, so a busy main pool cannot let it expire. */
export async function renewLease(renewals: Database, lease: Lease<unknown>, leaseMs: number): Promise<RenewResult> {
  const renewed = await renewals.sql<{ id: string }[]>`
    UPDATE queue.operations
    SET lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
        updated_at = clock_timestamp()
    WHERE id = ${lease.operationId} AND status = 'leased'
      AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
      AND lease_expires_at > clock_timestamp()
    RETURNING id
  `

  return renewed[0] ? 'renewed' : 'lease-lost'
}

/** Same fence as renewLease, and also tells the caller when the renewed lease expires. */
export async function renewLeaseWithAuthority(
  renewals: Database,
  lease: Lease<unknown>,
  leaseMs: number,
): Promise<LeaseAuthorityResult> {
  const [renewed] = await renewals.sql<{ lease_expires_at: Date }[]>`
    UPDATE queue.operations
    SET lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
        updated_at = clock_timestamp()
    WHERE id = ${lease.operationId} AND status = 'leased'
      AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
      AND lease_expires_at > clock_timestamp()
    RETURNING lease_expires_at
  `

  if (!renewed) return { outcome: 'lease-lost' }

  return { outcome: 'renewed', leaseExpiresAt: renewed.lease_expires_at }
}
