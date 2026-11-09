import type { Database } from '@brawltome/foundation'
import type { Lease } from '../jobs/job-definition'

export async function discoveryLeaseActive(database: Database, lease: Lease<unknown>): Promise<boolean> {
  const client = database.sql

  const [result] = await client<{ active: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM queue.operations
      WHERE id = ${lease.operationId} AND kind = ${lease.kind} AND status = 'leased'
        AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp()
    ) AS active
  `

  return result.active
}
