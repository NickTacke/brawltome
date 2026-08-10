import { type Database, player } from '@brawltome/database'
import { createPlayerReferenceQueries } from '@brawltome/player/composition'
import { eq } from 'drizzle-orm'

export function createDatabasePlayerReferenceQueries(
  db: Database,
  findRankedReference: (brawlhallaId: number) => Promise<{ brawlhallaId: number; name: string } | null> = async () =>
    null,
) {
  return createPlayerReferenceQueries(async (brawlhallaId) => {
    const rankedReference = await findRankedReference(brawlhallaId)
    if (rankedReference) return rankedReference
    const [stored] = await db
      .select({ brawlhallaId: player.brawlhallaId, name: player.name })
      .from(player)
      .where(eq(player.brawlhallaId, brawlhallaId))
      .limit(1)
    return stored ?? null
  })
}
