import { jsonb } from '@brawltome/foundation'
import { sql } from 'drizzle-orm'
import { bigint, boolean, integer, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AdmissionConfig, OperationFailure, OperationLease, OperationProvenance, WorkClass } from '../model'

// every column of each table the code uses, since tests/tables.test.ts compares them all with the database;
// defaults, checks, indexes and triggers stay in the migrations
//
// the .default() calls below mirror the migrations' defaults, so inserts may leave those columns out; nothing
// checks them against the migrations

type OperationStatus = 'awaiting_admission' | 'awaiting_binding' | 'pending' | 'leased' | 'succeeded' | 'dead_letter'

type InteractiveSection = 'ranked' | 'stats' | 'profile' | 'roster'

const clockTimestamp = sql`clock_timestamp()`

export const refreshOperationsSchema = pgSchema('queue')

export const operations = refreshOperationsSchema.table('operations', {
  id: uuid('id').primaryKey(),
  effectOperationId: uuid('effect_operation_id').notNull(),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  operationKey: text('operation_key').notNull(),
  resourceKey: text('resource_key'),
  workClass: text('work_class').$type<WorkClass>().notNull().default('interactive'),
  payloadVersion: integer('payload_version').notNull().default(1),
  payload: jsonb<OperationLease['payload']>('payload').notNull(),
  provenance: jsonb<OperationProvenance>('provenance').notNull(),
  status: text('status').$type<OperationStatus>().notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().default(clockTimestamp),
  leaseToken: bigint('lease_token', { mode: 'number' }).notNull().default(0),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  reservationToken: uuid('reservation_token'),
  reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true }),
  lastError: jsonb<OperationFailure>('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  replayedFromOperationId: uuid('replayed_from_operation_id'),
  originScheduleOccurrenceId: uuid('origin_schedule_occurrence_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

export const attempts = refreshOperationsSchema.table(
  'attempts',
  {
    operationId: uuid('operation_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    leaseToken: bigint('lease_token', { mode: 'number' }).notNull(),
    leaseOwner: text('lease_owner').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(clockTimestamp),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome: text('outcome').$type<'succeeded' | 'retry' | 'dead_letter' | 'lease_expired'>(),
    error: jsonb<OperationFailure>('error'),
  },
  (table) => [primaryKey({ columns: [table.operationId, table.attemptNumber] })],
)

export const deadLetterActions = refreshOperationsSchema.table('dead_letter_actions', {
  id: uuid('id').primaryKey(),
  targetOperationId: uuid('target_operation_id').notNull(),
  disposition: text('disposition').$type<'replayed' | 'discarded'>().notNull(),
  actorId: text('actor_id').notNull(),
  reason: text('reason').notNull(),
  replayOperationId: uuid('replay_operation_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

export const schedules = refreshOperationsSchema.table('schedules', {
  id: uuid('id').primaryKey(),
  scheduleKey: text('schedule_key').notNull().unique(),
  kind: text('kind').notNull(),
  resourceKey: text('resource_key'),
  workClass: text('work_class').$type<WorkClass>().notNull(),
  intervalMs: bigint('interval_ms', { mode: 'number' }).notNull(),
  firstDueAt: timestamp('first_due_at', { withTimezone: true }).notNull(),
  nextWindowNumber: bigint('next_window_number', { mode: 'number' }).notNull().default(0),
  nextDueAt: timestamp('next_due_at', { withTimezone: true }).notNull(),
  operationKeyPrefix: text('operation_key_prefix').notNull(),
  payloadVersion: integer('payload_version').notNull().default(1),
  payload: jsonb<OperationLease['payload']>('payload').notNull(),
  provenance: jsonb<OperationProvenance>('provenance').notNull(),
  maxAttempts: integer('max_attempts').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

export const scheduleOccurrences = refreshOperationsSchema.table('schedule_occurrences', {
  id: uuid('id').primaryKey(),
  scheduleId: uuid('schedule_id').notNull(),
  operationId: uuid('operation_id'),
  deduplicatedToOperationId: uuid('deduplicated_to_operation_id'),
  disposition: text('disposition').$type<'materialized' | 'deduplicated'>().notNull().default('materialized'),
  firstWindowNumber: bigint('first_window_number', { mode: 'number' }).notNull(),
  lastWindowNumber: bigint('last_window_number', { mode: 'number' }).notNull(),
  windowDueAt: timestamp('window_due_at', { withTimezone: true }).notNull(),
  materializedAt: timestamp('materialized_at', { withTimezone: true }).notNull(),
  latenessMs: bigint('lateness_ms', { mode: 'number' }).notNull(),
  missedWindowCount: bigint('missed_window_count', { mode: 'number' }).notNull(),
  catchUp: boolean('catch_up').notNull(),
})

// one row: the admission configuration the queue is running under
export const admissionPolicy = refreshOperationsSchema.table('admission_policy', {
  singleton: boolean('singleton').primaryKey().default(true),
  configHash: text('config_hash').notNull(),
  config: jsonb<AdmissionConfig>('config').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

export const admissionClasses = refreshOperationsSchema.table('admission_classes', {
  workClass: text('work_class').$type<WorkClass>().primaryKey(),
  credit: bigint('credit', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

export const interactiveRefreshEffects = refreshOperationsSchema.table(
  'interactive_refresh_effects',
  {
    operationId: uuid('operation_id').notNull(),
    section: text('section').$type<InteractiveSection>().notNull(),
    leaseToken: bigint('lease_token', { mode: 'number' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().default(clockTimestamp),
  },
  (table) => [primaryKey({ columns: [table.operationId, table.section] })],
)
