import type { Database } from '@brawltome/foundation'
import type { WorkClass } from '../model'

export type ReadAttemptHistoryInput = {
  kind: string
  groupByPayloadField: string
  windowDays: number
  provenanceSources: readonly string[]
  // when absent, every work class counts
  workClass?: WorkClass
  // operations whose last error has one of these codes are left out
  excludedErrorCodes?: readonly string[]
}

export type AttemptHistory = {
  payloadValue: string
  // distinct UTC days on which one of these operations was created
  createdDays: number
  lastCreatedAt: Date
  lastDeadLetteredAt: Date | null
}

type AttemptHistoryRow = {
  payload_value: string
  created_days: number
  last_created_at: Date
  last_dead_lettered_at: Date | null
}

/** The recent history of a kind's operations, one row per value of a payload field. */
export async function readAttemptHistory(
  database: Database,
  input: ReadAttemptHistoryInput,
): Promise<AttemptHistory[]> {
  const client = database.sql
  const onlyWorkClass = input.workClass ? client`AND work_class = ${input.workClass}` : client``

  const rows = await client<AttemptHistoryRow[]>`
    SELECT payload->>${input.groupByPayloadField}::text AS payload_value,
           count(DISTINCT (created_at AT TIME ZONE 'UTC')::date)::integer AS created_days,
           max(created_at) AS last_created_at,
           max(created_at) FILTER (WHERE status = 'dead_letter') AS last_dead_lettered_at
    FROM refresh_operations.operations
    WHERE kind = ${input.kind}
      AND created_at > clock_timestamp() - make_interval(days => ${input.windowDays})
      AND provenance->>'source' = ANY (${[...input.provenanceSources]}::text[])
      AND coalesce(last_error->>'code', '') <> ALL (${[...(input.excludedErrorCodes ?? [])]}::text[])
      ${onlyWorkClass}
    GROUP BY 1
  `

  return rows.map((row) => ({
    payloadValue: row.payload_value,
    createdDays: row.created_days,
    lastCreatedAt: row.last_created_at,
    lastDeadLetteredAt: row.last_dead_lettered_at,
  }))
}
