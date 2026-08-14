import { type Database, player } from '@brawltome/database'
import { type CanonicalPlayerNameEvidence, selectCanonicalPlayerName } from '@brawltome/player'
import { createPlayerReferenceQueries } from '@brawltome/player/composition'
import { eq } from 'drizzle-orm'

type CanonicalReferenceEvidence = CanonicalPlayerNameEvidence & {
  brawlhallaId: number
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

type FindCanonicalReference = (brawlhallaId: number) => Promise<CanonicalReferenceEvidence | null>

export function createDatabasePlayerReferenceQueries(
  db: Database,
  findRankedReference: FindCanonicalReference = async () => null,
  findCareerReference: FindCanonicalReference = async () => null,
) {
  return createPlayerReferenceQueries(async (brawlhallaId) => {
    const rankedReference = await findRankedReference(brawlhallaId)
    const careerReference = await findCareerReference(brawlhallaId)
    const nameEvidence = selectCanonicalPlayerName({
      brawlhallaId,
      ranked: rankedReference,
      career: careerReference,
    })
    const metadata = {
      bestLegendNameKey: rankedReference?.bestLegendNameKey ?? careerReference?.bestLegendNameKey,
      legacyRating: rankedReference?.legacyRating,
    }
    if (nameEvidence) return { brawlhallaId, name: nameEvidence.name, ...metadata }
    const [stored] = await db
      .select({ brawlhallaId: player.brawlhallaId, name: player.name })
      .from(player)
      .where(eq(player.brawlhallaId, brawlhallaId))
      .limit(1)
    return stored ? { ...stored, ...metadata } : null
  })
}
