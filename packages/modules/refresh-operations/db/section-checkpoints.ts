import type { Database, Sql } from '@brawltome/foundation'
import type { EffectState, Lease } from '../jobs/job-definition'
import type { SectionCheckpointResult, TransitionResult } from '../model'

/** Says whether a section still has to run under this lease, or was committed by an earlier attempt. */
export async function beginSection(
  database: Database,
  lease: Lease<unknown>,
  section: string,
): Promise<SectionCheckpointResult> {
  const [owned] = await database.sql<{ completed: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM refresh_operations.interactive_refresh_effects
      WHERE operation_id = ${lease.effectOperationId} AND section = ${section}
    ) AS completed
    FROM refresh_operations.operations
    WHERE id = ${lease.operationId} AND status = 'leased'
      AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
      AND lease_expires_at > clock_timestamp()
  `

  if (!owned) return 'lease-lost'

  return owned.completed ? 'already-applied' : 'execute'
}

/** Records a finished section on the effect operation, so a later attempt or a replay does not run it again. */
export function commitSection(database: Database, lease: Lease<unknown>, section: string): Promise<TransitionResult> {
  return database.sql.begin(async (transaction) => {
    const sql = transaction as unknown as Sql

    const [owned] = await sql<{ id: string }[]>`
      SELECT id FROM refresh_operations.operations
      WHERE id = ${lease.operationId} AND status = 'leased'
        AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp()
      FOR UPDATE
    `

    if (!owned) return 'lease-lost' as const

    await sql`
      INSERT INTO refresh_operations.interactive_refresh_effects (operation_id, section, lease_token)
      VALUES (${lease.effectOperationId}, ${section}, ${lease.leaseToken})
      ON CONFLICT (operation_id, section) DO NOTHING
    `

    return 'transitioned' as const
  })
}

/** Says whether every given section has a checkpoint on the effect operation, inside claim's transaction. */
export async function allSectionsCommitted(
  transaction: Sql,
  lease: Pick<Lease<unknown>, 'effectOperationId'>,
  sections: readonly string[],
): Promise<EffectState> {
  const [effect] = await transaction<{ complete: boolean }[]>`
    SELECT NOT EXISTS (
      SELECT 1
      FROM unnest(${[...sections]}::text[]) AS required(section)
      WHERE NOT EXISTS (
        SELECT 1
        FROM refresh_operations.interactive_refresh_effects effect
        WHERE effect.operation_id = ${lease.effectOperationId} AND effect.section = required.section
      )
    ) AS complete
  `

  return effect?.complete ? 'acknowledged' : 'none'
}

/** Says whether one section has a checkpoint on the effect operation, inside claim's transaction. */
export function sectionCommitted(
  transaction: Sql,
  lease: Pick<Lease<unknown>, 'effectOperationId'>,
  section: string,
): Promise<EffectState> {
  return allSectionsCommitted(transaction, lease, [section])
}
