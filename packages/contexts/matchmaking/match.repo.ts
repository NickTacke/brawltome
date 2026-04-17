import type { Database } from '@brawltome/database'
import { matchEvents, matchPlayers, matches } from '@brawltome/database'
import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import type { MatchEventRow, MatchPlayerRow, MatchRow, MatchSlug } from './match'

export type Cursor = { uploadedAt: Date; slug: string }

export interface MatchRepo {
  findBySlug(slug: MatchSlug): Promise<MatchRow | null>
  findByDedupeHash(hash: string): Promise<MatchRow | null>
  findPlayers(slug: MatchSlug): Promise<MatchPlayerRow[]>
  findEvents(slug: MatchSlug): Promise<MatchEventRow[]>
  listByPlayer(brawlhallaId: number, cursor: Cursor | null, limit: number): Promise<MatchRow[]>
  insertMatch(row: Omit<MatchRow, 'uploadedAt'> & { uploadedAt?: Date }): Promise<void>
  insertPlayers(rows: Omit<MatchPlayerRow, 'id'>[]): Promise<void>
  insertEvents(rows: Omit<MatchEventRow, 'id'>[]): Promise<void>
  listPendingByFormatVersion(formatVersion: number, limit: number): Promise<MatchRow[]>
  markParsed(slug: MatchSlug, patch: Partial<MatchRow>): Promise<void>
  updatePlayerCosmetics(
    slug: MatchSlug,
    replayEntityId: number,
    patch: Partial<MatchPlayerRow>,
  ): Promise<void>
  deleteMatch(slug: MatchSlug): Promise<void>
}

export function createMatchRepo(db: Database): MatchRepo {
  return {
    async findBySlug(slug) {
      const rows = await db.select().from(matches).where(eq(matches.slug, slug)).limit(1)
      return (rows[0] as MatchRow | undefined) ?? null
    },

    async findByDedupeHash(hash) {
      const rows = await db.select().from(matches).where(eq(matches.dedupeHash, hash)).limit(1)
      return (rows[0] as MatchRow | undefined) ?? null
    },

    async findPlayers(slug) {
      return (await db
        .select()
        .from(matchPlayers)
        .where(eq(matchPlayers.matchSlug, slug))) as MatchPlayerRow[]
    },

    async findEvents(slug) {
      return (await db
        .select()
        .from(matchEvents)
        .where(eq(matchEvents.matchSlug, slug))
        .orderBy(matchEvents.timestampMs)) as MatchEventRow[]
    },

    async listByPlayer(brawlhallaId, cursor, limit) {
      const inPlayer = db
        .select({ slug: matchPlayers.matchSlug })
        .from(matchPlayers)
        .where(eq(matchPlayers.brawlhallaId, brawlhallaId))
      const cursorCond = cursor
        ? or(
            lt(matches.uploadedAt, cursor.uploadedAt),
            and(eq(matches.uploadedAt, cursor.uploadedAt), lt(matches.slug, cursor.slug)),
          )
        : undefined
      const where = cursorCond
        ? and(sql`${matches.slug} IN ${inPlayer}`, cursorCond)
        : sql`${matches.slug} IN ${inPlayer}`
      const rows = await db
        .select()
        .from(matches)
        .where(where)
        .orderBy(desc(matches.uploadedAt), desc(matches.slug))
        .limit(limit)
      return rows as MatchRow[]
    },

    async insertMatch(row) {
      await db.insert(matches).values(row as typeof matches.$inferInsert)
    },

    async insertPlayers(rows) {
      if (rows.length === 0) return
      await db.insert(matchPlayers).values(rows as (typeof matchPlayers.$inferInsert)[])
    },

    async insertEvents(rows) {
      if (rows.length === 0) return
      await db.insert(matchEvents).values(rows as (typeof matchEvents.$inferInsert)[])
    },

    async listPendingByFormatVersion(formatVersion, limit) {
      return (await db
        .select()
        .from(matches)
        .where(and(eq(matches.parseStatus, 'pending'), eq(matches.formatVersion, formatVersion)))
        .limit(limit)) as MatchRow[]
    },

    async markParsed(slug, patch) {
      await db
        .update(matches)
        .set({ ...patch, parseStatus: 'parsed' } as Partial<typeof matches.$inferInsert>)
        .where(eq(matches.slug, slug))
    },

    async updatePlayerCosmetics(slug, replayEntityId, patch) {
      await db
        .update(matchPlayers)
        .set(patch as Partial<typeof matchPlayers.$inferInsert>)
        .where(
          and(eq(matchPlayers.matchSlug, slug), eq(matchPlayers.replayEntityId, replayEntityId)),
        )
    },

    async deleteMatch(slug) {
      await db.delete(matches).where(eq(matches.slug, slug))
    },
  }
}
