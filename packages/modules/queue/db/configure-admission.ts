import type { Database } from '@brawltome/foundation'
import { admissionConfigHash, validateAdmissionConfig } from '../domain/admission'
import type { AdmissionConfig } from '../model'
import { admissionLockId } from './admission-lock'

export async function configureAdmission(database: Database, admission: AdmissionConfig): Promise<void> {
  const client = database.sql

  validateAdmissionConfig(admission)
  const policy = admissionConfigHash(admission)

  await client.begin(async (transaction) => {
    const sql = transaction as unknown as typeof client

    await sql`SELECT pg_advisory_xact_lock(${admissionLockId})`

    const [active] = await sql<{ count: string | number }[]>`
      SELECT count(*)::bigint AS count
      FROM refresh_operations.operations
      WHERE status = 'leased' AND lease_expires_at > clock_timestamp()
    `

    const [existing] = await sql<{ config_hash: string }[]>`
      SELECT config_hash FROM refresh_operations.admission_policy WHERE singleton FOR UPDATE
    `

    if (existing && existing.config_hash !== policy.hash && Number(active.count) > 0) {
      throw new Error('admission configuration cannot change while operations are actively leased')
    }

    await sql`
      INSERT INTO refresh_operations.admission_policy (singleton, config_hash, config)
      VALUES (true, ${policy.hash}, ${sql.json(policy.document)})
      ON CONFLICT (singleton) DO UPDATE
      SET config_hash = EXCLUDED.config_hash, config = EXCLUDED.config, updated_at = clock_timestamp()
    `

    if (existing && existing.config_hash !== policy.hash) {
      await sql`UPDATE refresh_operations.admission_classes SET credit = 0, updated_at = clock_timestamp()`
    }
  })
}
