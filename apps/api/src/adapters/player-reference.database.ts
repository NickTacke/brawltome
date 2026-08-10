import { type Database, player } from '@brawltome/database'
import { createPlayerReferenceQueries } from '@brawltome/player/composition'
import { eq } from 'drizzle-orm'

type FindCanonicalReference = (brawlhallaId: number) => Promise<{ brawlhallaId: number; name: string } | null>

export function createDatabasePlayerReferenceQueries(
  db: Database,
  findRankedReference: FindCanonicalReference = async () => null,
  findCareerReference: FindCanonicalReference = async () => null,
) {
  return createPlayerReferenceQueries(async (brawlhallaId) => {
    const rankedReference = await findRankedReference(brawlhallaId)
    if (rankedReference) return rankedReference
    const careerReference = await findCareerReference(brawlhallaId)
    if (careerReference) return careerReference
    const [stored] = await db
      .select({ brawlhallaId: player.brawlhallaId, name: player.name })
      .from(player)
      .where(eq(player.brawlhallaId, brawlhallaId))
      .limit(1)
    return stored ?? null
  })
}
