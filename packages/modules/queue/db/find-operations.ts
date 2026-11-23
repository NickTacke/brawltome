import type { Database } from '@brawltome/foundation'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import type { WorkClass } from '../model'
import { payloadMatches } from './payload-matches'
import { operations } from './tables'

const activeStatuses = ['awaiting_admission', 'pending', 'leased'] as const

type OperationStatus = typeof operations.$inferSelect.status

// a drizzle database or a transaction on it
type Reader = Pick<Database['db'], 'select'>

export type FindActiveOperationInput = {
  kind: string
  dedupeKey: string
  // also matches the operation holding this resource, for kinds that allow one active operation per resource
  resourceKey?: string
}

export type ActiveOperation = {
  operationId: string
  awaitingAdmission: boolean
  reservationExpired: boolean
}

export async function readActiveOperation(
  reader: Reader,
  input: FindActiveOperationInput,
): Promise<ActiveOperation | null> {
  const sameDedupeKey = eq(operations.dedupeKey, input.dedupeKey)
  const sameResource = input.resourceKey === undefined ? undefined : eq(operations.resourceKey, input.resourceKey)

  const [active] = await reader
    .select({
      operationId: operations.id,
      awaitingAdmission: sql<boolean>`${operations.status} = 'awaiting_admission'`,
      reservationExpired: sql<boolean>`${operations.status} = 'awaiting_admission'
        AND ${operations.reservationExpiresAt} <= clock_timestamp()`,
    })
    .from(operations)
    .where(
      and(eq(operations.kind, input.kind), or(sameDedupeKey, sameResource), inArray(operations.status, activeStatuses)),
    )

  return active ?? null
}

export function findActiveOperation(
  database: Database,
  input: FindActiveOperationInput,
): Promise<ActiveOperation | null> {
  return readActiveOperation(database.db, input)
}

export type ActiveOperationDetails = ActiveOperation & {
  workClass: WorkClass
  status: (typeof activeStatuses)[number]
  payload: unknown
}

/** The active operation of a kind on a resource, or under a dedupe key, with its class, status and payload too. */
export async function findActiveOperationDetails(
  database: Database,
  input: { kind: string; resourceKey: string; dedupeKey?: string },
): Promise<ActiveOperationDetails | null> {
  const sameResource = eq(operations.resourceKey, input.resourceKey)
  const sameDedupeKey = input.dedupeKey === undefined ? undefined : eq(operations.dedupeKey, input.dedupeKey)

  const [active] = await database.db
    .select({
      operationId: operations.id,
      workClass: operations.workClass,
      status: operations.status,
      payload: operations.payload,
      awaitingAdmission: sql<boolean>`${operations.status} = 'awaiting_admission'`,
      reservationExpired: sql<boolean>`${operations.status} = 'awaiting_admission'
        AND ${operations.reservationExpiresAt} <= clock_timestamp()`,
    })
    .from(operations)
    .where(
      and(eq(operations.kind, input.kind), or(sameResource, sameDedupeKey), inArray(operations.status, activeStatuses)),
    )

  if (!active) return null

  return { ...active, status: active.status as ActiveOperationDetails['status'] }
}

export type ListAwaitingInput = {
  kinds: readonly string[]
  status: OperationStatus
  limit: number
}

/** Operation ids of these kinds in this status, oldest first. */
export async function listAwaiting(database: Database, input: ListAwaitingInput): Promise<string[]> {
  const rows = await database.db
    .select({ id: operations.id })
    .from(operations)
    .where(and(inArray(operations.kind, input.kinds), eq(operations.status, input.status)))
    .orderBy(asc(operations.createdAt), asc(operations.id))
    .limit(input.limit)

  return rows.map((row) => row.id)
}

export type CountActiveInput = {
  kind: string
  workClass: WorkClass
  // top-level payload keys the operation must hold, as text
  payloadEquals: Record<string, string>
}

// a reservation whose admission window has passed is only rejected when someone next asks for that resource, so
// until then it sits in awaiting_admission without being work anyone is waiting on
const isLiveReservation = sql`(${operations.status} <> 'awaiting_admission'
  OR ${operations.reservationExpiresAt} > clock_timestamp())`

/** How many operations of this kind and class are waiting for admission, pending or leased; expired reservations aside. */
export async function countActive(database: Database, input: CountActiveInput): Promise<number> {
  const [row] = await database.db
    .select({ count: sql<number>`count(*)::integer` })
    .from(operations)
    .where(
      and(
        eq(operations.kind, input.kind),
        eq(operations.workClass, input.workClass),
        inArray(operations.status, activeStatuses),
        isLiveReservation,
        ...payloadMatches(input.payloadEquals),
      ),
    )

  return row.count
}
