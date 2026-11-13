import { jsonb } from '@brawltome/foundation'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  pgSchema,
  primaryKey,
  smallint,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// every column of each table the code uses, since tests/tables.test.ts compares them all with the database;
// defaults, checks, indexes and triggers stay in the migrations

export const replaysSchema = pgSchema('replays')

export type UploadRejection = { code: string }
export type JobFailure = { code: string; message: string }
export type WeaponStats = Record<string, Record<string, number>>

export const replayFiles = replaysSchema.table('replay_files', {
  digest: varchar('digest', { length: 71 }).primaryKey(),
  byteSize: integer('byte_size').notNull(),
  patch: varchar('patch', { length: 16 }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
})

export const uploads = replaysSchema.table('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull(),
  digest: varchar('digest', { length: 71 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  fileName: varchar('file_name', { length: 255 }),
  byOperator: boolean('by_operator').notNull().default(false),
  status: varchar('status', { length: 16 }).notNull().default('queued'),
  rejection: jsonb<UploadRejection>('rejection'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
})

export const jobs = replaysSchema.table('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  digest: varchar('digest', { length: 71 }).notNull(),
  kind: varchar('kind', { length: 8 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  attempts: smallint('attempts').notNull().default(0),
  leaseToken: uuid('lease_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  failure: jsonb<JobFailure>('failure'),
  build: varchar('build', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
})

export const matches = replaysSchema.table('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  digest: varchar('digest', { length: 71 }).notNull(),
  candidateKey: varchar('candidate_key', { length: 128 }).notNull(),
  mergedInto: uuid('merged_into'),
  patch: varchar('patch', { length: 16 }).notNull(),
  format: smallint('format').notNull(),
  build: varchar('build', { length: 64 }).notNull(),
  mapId: integer('map_id').notNull(),
  mapName: varchar('map_name', { length: 64 }).notNull(),
  modeName: varchar('mode_name', { length: 32 }).notNull(),
  queue: varchar('queue', { length: 16 }),
  isRanked: boolean('is_ranked').notNull(),
  isCustom: boolean('is_custom').notNull(),
  hasTeams: boolean('has_teams').notNull(),
  hasTeamDamage: boolean('has_team_damage').notNull(),
  stocks: smallint('stocks'),
  durationMs: integer('duration_ms').notNull(),
  winnerTeam: smallint('winner_team'),
  isReliable: boolean('is_reliable').notNull(),
  failedChecks: jsonb<string[]>('failed_checks').notNull(),
  unchecked: jsonb<string[]>('unchecked').notNull(),
  timelineKey: varchar('timeline_key', { length: 200 }),
  playedAt: timestamp('played_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  parsedAt: timestamp('parsed_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
})

export const matchPlayers = replaysSchema.table(
  'match_players',
  {
    matchId: uuid('match_id').notNull(),
    slot: smallint('slot').notNull(),
    brawlhallaId: bigint('brawlhalla_id', { mode: 'number' }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    team: smallint('team').notNull(),
    legendId: integer('legend_id').notNull(),
    legendName: varchar('legend_name', { length: 64 }).notNull(),
    damageDealt: doublePrecision('damage_dealt').notNull(),
    damageTaken: doublePrecision('damage_taken').notNull(),
    kos: smallint('kos').notNull(),
    deaths: smallint('deaths').notNull(),
    suicides: smallint('suicides').notNull(),
    teamKos: smallint('team_kos').notNull(),
    clashes: smallint('clashes').notNull(),
    dodges: smallint('dodges').notNull(),
    airDodges: smallint('air_dodges').notNull(),
    jumps: smallint('jumps').notNull(),
    airJumps: smallint('air_jumps').notNull(),
    dashes: smallint('dashes').notNull(),
    dashJumps: smallint('dash_jumps').notNull(),
    timeInAirMs: integer('time_in_air_ms').notNull(),
    timeOnGroundMs: integer('time_on_ground_ms').notNull(),
    timeOnWallMs: integer('time_on_wall_ms').notNull(),
    score: integer('score').notNull(),
    weapons: jsonb<WeaponStats>('weapons').notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.slot] })],
)

export const matchUploads = replaysSchema.table(
  'match_uploads',
  {
    matchId: uuid('match_id').notNull(),
    uploadId: uuid('upload_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.uploadId] })],
)
