import type { Database } from '@brawltome/database'
import { playerLink } from '@brawltome/database'
import { eq } from 'drizzle-orm'

export type PlayerLinkStatus = 'pending' | 'linked' | 'failed' | 'conflict'

export interface PlayerLink {
  userId: string
  brawlhallaId: number | null
  steamId: string
  linkedVia: 'steam' | 'desktop'
  status: PlayerLinkStatus
  linkedAt: Date
}

export interface PlayerLinkRepo {
  findByUserId(userId: string): Promise<PlayerLink | null>
  findByBrawlhallaId(brawlhallaId: number): Promise<PlayerLink | null>
  createPending(params: { userId: string; steamId: string }): Promise<PlayerLink>
  resolve(userId: string, brawlhallaId: number): Promise<void>
  setStatus(userId: string, status: PlayerLinkStatus): Promise<void>
  deleteByUserId(userId: string): Promise<void>
}

export function createPlayerLinkRepo(db: Database): PlayerLinkRepo {
  return {
    async findByUserId(userId) {
      const row = await db.query.playerLink.findFirst({
        where: eq(playerLink.userId, userId),
      })
      return (row as PlayerLink) ?? null
    },

    async findByBrawlhallaId(brawlhallaId) {
      const row = await db.query.playerLink.findFirst({
        where: eq(playerLink.brawlhallaId, brawlhallaId),
      })
      return (row as PlayerLink) ?? null
    },

    async createPending({ userId, steamId }) {
      const [row] = await db.insert(playerLink).values({ userId, steamId, status: 'pending' }).returning()
      return row as PlayerLink
    },

    async resolve(userId, brawlhallaId) {
      await db.update(playerLink).set({ brawlhallaId, status: 'linked' }).where(eq(playerLink.userId, userId))
    },

    async setStatus(userId, status) {
      await db.update(playerLink).set({ status }).where(eq(playerLink.userId, userId))
    },

    async deleteByUserId(userId) {
      await db.delete(playerLink).where(eq(playerLink.userId, userId))
    },
  }
}
