import type { Sql } from '@brawltome/foundation'

export type EffectLineage = {
  hasUnfinished: boolean
  hasFinished: boolean
  lastFinishedAt: Date | null
}

type LineageRow = {
  effect_operation_id: string
  has_unfinished: boolean
  has_finished: boolean
  last_finished_at: Date | null
}

/**
 * For each effect, what the operations that share it (the original and any replays) add up to. An effect with no
 * operations is absent from the map.
 */
export async function readEffectLineage(
  sql: Sql,
  effectOperationIds: readonly string[],
): Promise<Map<string, EffectLineage>> {
  if (effectOperationIds.length === 0) return new Map()

  const rows = await sql<LineageRow[]>`
    SELECT effect_operation_id,
           bool_or(status NOT IN ('succeeded', 'dead_letter')) AS has_unfinished,
           bool_or(status IN ('succeeded', 'dead_letter')) AS has_finished,
           max(completed_at) FILTER (WHERE status IN ('succeeded', 'dead_letter')) AS last_finished_at
    FROM refresh_operations.operations
    WHERE effect_operation_id = ANY(${[...effectOperationIds]}::uuid[])
    GROUP BY effect_operation_id
  `

  return new Map(
    rows.map((row) => [
      row.effect_operation_id,
      {
        hasUnfinished: row.has_unfinished,
        hasFinished: row.has_finished,
        lastFinishedAt: row.last_finished_at,
      },
    ]),
  )
}

export type OperationIdentity = {
  operationId: string
  effectOperationId: string
  operationKey: string
  kind: string
}

export async function operationMatches(sql: Sql, identity: OperationIdentity): Promise<boolean> {
  const [operation] = await sql<{ matches: boolean }[]>`
    SELECT effect_operation_id = ${identity.effectOperationId}
       AND operation_key = ${identity.operationKey}
       AND kind = ${identity.kind} AS matches
    FROM refresh_operations.operations WHERE id = ${identity.operationId}
  `

  return operation?.matches === true
}
