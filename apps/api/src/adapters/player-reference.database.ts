import { type Database, player } from '@brawltome/database'
import { CAREER_FRESHNESS_SECONDS, RANKED_FRESHNESS_SECONDS } from '@brawltome/player'
import { createPlayerReferenceQueries, isUsablePlayerName } from '@brawltome/player/composition'
import { eq } from 'drizzle-orm'

type CanonicalReferenceEvidence = {
  brawlhallaId: number
  name: string
  lastSuccessAt?: Date | null
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

type FindCanonicalReference = (brawlhallaId: number) => Promise<CanonicalReferenceEvidence | null>

function isFresh(reference: CanonicalReferenceEvidence | null, freshnessSeconds: number, now: Date): boolean {
  return Boolean(
    reference?.lastSuccessAt && now.getTime() - reference.lastSuccessAt.getTime() <= freshnessSeconds * 1_000,
  )
}

function selectNameEvidence(
  brawlhallaId: number,
  ranked: CanonicalReferenceEvidence | null,
  career: CanonicalReferenceEvidence | null,
  now: Date,
): CanonicalReferenceEvidence | null {
  const usableCareer = career && isUsablePlayerName(career.name, brawlhallaId) ? career : null
  const usableRanked = ranked && isUsablePlayerName(ranked.name, brawlhallaId) ? ranked : null
  if (isFresh(usableCareer, CAREER_FRESHNESS_SECONDS, now)) return usableCareer
  if (isFresh(usableRanked, RANKED_FRESHNESS_SECONDS, now)) return usableRanked
  if (!usableCareer) return usableRanked
  if (!usableRanked) return usableCareer
  return (usableCareer.lastSuccessAt?.getTime() ?? 0) >= (usableRanked.lastSuccessAt?.getTime() ?? 0)
    ? usableCareer
    : usableRanked
}

export function createDatabasePlayerReferenceQueries(
  db: Database,
  findRankedReference: FindCanonicalReference = async () => null,
  findCareerReference: FindCanonicalReference = async () => null,
  now: () => Date = () => new Date(),
) {
  return createPlayerReferenceQueries(async (brawlhallaId) => {
    const rankedReference = await findRankedReference(brawlhallaId)
    const careerReference = await findCareerReference(brawlhallaId)
    const nameEvidence = selectNameEvidence(brawlhallaId, rankedReference, careerReference, now())
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
