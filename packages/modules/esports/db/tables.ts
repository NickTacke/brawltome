import { jsonb } from '@brawltome/foundation'
import { bigint, boolean, integer, pgSchema, primaryKey, smallint, text, timestamp } from 'drizzle-orm/pg-core'

// every column of each table the code uses, since tests/tables.test.ts compares them all with the database;
// defaults, checks, indexes and triggers stay in the migrations

export const esportsSchema = pgSchema('esports')

// the raw { earnings, pr } object brawltools gives for one mode
export type BrawltoolsPowerRanking = { earnings: number; pr: number }

// one row per player we asked Brawltools about; link is 'linked' when Brawltools knows the account and 'none' when
// it answered 404. the failure columns drive the back-off after a failed refresh
export const players = esportsSchema.table('players', {
  brawlhallaId: bigint('brawlhalla_id', { mode: 'number' }).primaryKey(),
  brawltoolsPlayerId: integer('brawltools_player_id'),
  brawltoolsName: text('brawltools_name'),
  link: text('link').notNull(),
  powerRanking1v1: jsonb<BrawltoolsPowerRanking>('pr_1v1'),
  powerRanking2v2: jsonb<BrawltoolsPowerRanking>('pr_2v2'),
  eventLegends: jsonb<unknown[]>('event_legends').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  failureCount: integer('failure_count').notNull(),
})

// mode is 1 for 1v1 and 2 for 2v2; a player has one row per tournament and mode
export const placements = esportsSchema.table(
  'placements',
  {
    brawlhallaId: bigint('brawlhalla_id', { mode: 'number' }).notNull(),
    mode: smallint('mode').notNull(),
    tournamentId: text('tournament_id').notNull(),
    tournamentName: text('tournament_name').notNull(),
    isOfficial: boolean('is_official').notNull(),
    isOnline: boolean('is_online').notNull(),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    placement: integer('placement').notNull(),
  },
  (table) => [primaryKey({ columns: [table.brawlhallaId, table.mode, table.tournamentId] })],
)

// sets holds the raw playerMatches of the event, so the shaping can change without asking Brawltools again
export const eventSets = esportsSchema.table(
  'event_sets',
  {
    brawlhallaId: bigint('brawlhalla_id', { mode: 'number' }).notNull(),
    tournamentId: text('tournament_id').notNull(),
    sets: jsonb<unknown[]>('sets').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.brawlhallaId, table.tournamentId] })],
)
