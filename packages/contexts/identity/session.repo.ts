import type { Database } from '@brawltome/database'
import { session } from '@brawltome/database'
import { eq, lt } from 'drizzle-orm'
import type { Session } from './session'

export interface SessionRepo {
  create(params: { id: string; userId: string; expiresAt: Date }): Promise<Session>
  findById(id: string): Promise<Session | null>
  deleteById(id: string): Promise<void>
  extend(id: string, expiresAt: Date): Promise<void>
  deleteExpired(now: Date): Promise<number>
}

export function createSessionRepo(db: Database): SessionRepo {
  return {
    async create({ id, userId, expiresAt }) {
      const [row] = await db.insert(session).values({ id, userId, expiresAt }).returning()
      return row
    },

    async findById(id) {
      const row = await db.query.session.findFirst({ where: eq(session.id, id) })
      return row ?? null
    },

    async deleteById(id) {
      await db.delete(session).where(eq(session.id, id))
    },

    async extend(id, expiresAt) {
      await db.update(session).set({ expiresAt }).where(eq(session.id, id))
    },

    async deleteExpired(now) {
      const rows = await db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id })
      return rows.length
    },
  }
}
