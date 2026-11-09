import { jsonb } from '@brawltome/foundation'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import type { ClanProvenance } from '../domain/provenance'

// every column of each table the code uses, since tests/tables.test.ts compares them all with the database;
// defaults, checks, indexes and triggers stay in the migrations
//
// the few .default() calls below mirror the migrations' defaults, so inserts may leave those columns out; nothing
// checks them against the migrations

export const clansSchema = pgSchema('clans')

export const clans = clansSchema.table('clans', {
  clanId: integer('clan_id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
})

export const profiles = clansSchema.table('profiles', {
  clanId: integer('clan_id').primaryKey(),
  clanName: text('clan_name').notNull(),
  clanCreateDate: timestamp('clan_create_date', { withTimezone: true }).notNull(),
  clanXp: numeric('clan_xp', { precision: 40, scale: 0 }).notNull(),
  clanLifetimeXp: numeric('clan_lifetime_xp', { precision: 41, scale: 0 }).notNull(),
  notice: text('notice'),
  tags: jsonb<string[]>('tags'),
  discordInviteCode: text('discord_invite_code'),
  guildPoints: numeric('guild_points', { precision: 40, scale: 0 }),
  isRecruiting: boolean('is_recruiting'),
})

export const profileState = clansSchema.table('profile_state', {
  clanId: integer('clan_id').primaryKey(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  checkProvenance: jsonb<ClanProvenance>('check_provenance').notNull(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastSuccessProvenance: jsonb<ClanProvenance>('last_success_provenance'),
})

// checked_at is null for rosters imported from v2 that were never checked since
export const rosterState = clansSchema.table('roster_state', {
  clanId: integer('clan_id').primaryKey(),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  checkProvenance: jsonb<ClanProvenance>('check_provenance').notNull(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastSuccessProvenance: jsonb<ClanProvenance>('last_success_provenance'),
})

// name, rank and join date are null when the source left them out; observed_at is null for imported rows
export const members = clansSchema.table(
  'members',
  {
    clanId: integer('clan_id').notNull(),
    brawlhallaId: integer('brawlhalla_id').notNull().unique(),
    name: text('name'),
    rank: text('rank'),
    joinDate: timestamp('join_date', { withTimezone: true }),
    xp: numeric('xp', { precision: 40, scale: 0 }).notNull(),
    guildPoints: numeric('guild_points', { precision: 40, scale: 0 }),
    observedAt: timestamp('observed_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.clanId, table.brawlhallaId] })],
)

// the clan side of a refresh lease, so a publication can check the lease in the same transaction as its writes
export const refreshEffects = clansSchema.table(
  'refresh_effects',
  {
    operationId: uuid('operation_id').notNull(),
    section: text('section', { enum: ['profile', 'roster'] }).notNull(),
    leaseToken: bigint('lease_token', { mode: 'number' }).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.operationId, table.section] })],
)

// one row; triggers on profiles and members bump source_version and add an outbox event per changed clan
export const discoveryState = clansSchema.table('discovery_state', {
  singleton: boolean('singleton').primaryKey().default(true),
  sourceVersion: bigint('source_version', { mode: 'number' }).notNull().default(0),
})

export const discoveryOutbox = clansSchema.table('discovery_outbox', {
  eventId: uuid('event_id').primaryKey().defaultRandom(),
  clanId: integer('clan_id').notNull(),
  sourceVersion: bigint('source_version', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
})

// one row per week the snapshot job has started; last_clan_id is where the job carries on, and only weeks with a
// completed_at feed the Last week figure
export const weeklySnapshotRuns = clansSchema.table('weekly_snapshot_runs', {
  weekStarting: date('week_starting', { mode: 'string' }).primaryKey(),
  lastClanId: integer('last_clan_id').notNull().default(0),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

// a clan's guild points as the snapshot job fetched them in that week
export const weeklySnapshots = clansSchema.table(
  'weekly_snapshots',
  {
    weekStarting: date('week_starting', { mode: 'string' }).notNull(),
    clanId: integer('clan_id').notNull(),
    guildPoints: numeric('guild_points', { precision: 40, scale: 0 }).notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (table) => [primaryKey({ columns: [table.weekStarting, table.clanId] })],
)
