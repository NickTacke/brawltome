import { type Database, player } from '@brawltome/database'
import { createPlayerReferenceQueries } from '@brawltome/player/composition'
import { eq } from 'drizzle-orm'

export function createDatabasePlayerReferenceQueries(db: Database) {
  return createPlayerReferenceQueries(async (brawlhallaId) => {
    const [stored] = await db
      .select({ brawlhallaId: player.brawlhallaId, name: player.name })
      .from(player)
      .where(eq(player.brawlhallaId, brawlhallaId))
      .limit(1)
    return stored ?? null
  })
}
