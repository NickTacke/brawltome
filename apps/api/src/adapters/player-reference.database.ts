import type { Database } from '@brawltome/database'
import { type CanonicalPlayerNameEvidence, selectCanonicalPlayerName } from '@brawltome/player'
import { createPlayerReferenceQueries } from '@brawltome/player/composition'
import { sql } from 'drizzle-orm'

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
    const [rankedReference, careerReference, aliasRows] = await Promise.all([
      findRankedReference(brawlhallaId),
      findCareerReference(brawlhallaId),
      db.execute<{ display_alias: string }>(sql`
        SELECT display_alias
        FROM (
          SELECT DISTINCT ON (normalized_alias) normalized_alias, display_alias, observed_at, source_rank
          FROM (
            SELECT normalized_alias, display_alias, observed_at, 0 AS source_rank
            FROM players.discovery_aliases WHERE brawlhalla_id = ${brawlhallaId}
            UNION ALL
            SELECT normalized_alias, display_alias, observed_at, 1 AS source_rank
            FROM players.legacy_discovery_aliases WHERE brawlhalla_id = ${brawlhallaId}
          ) aliases
          ORDER BY normalized_alias, source_rank, observed_at DESC
        ) deduplicated
        ORDER BY observed_at DESC, display_alias
      `),
    ])
    const nameEvidence = selectCanonicalPlayerName({
      brawlhallaId,
      ranked: rankedReference,
      career: careerReference,
    })
    if (!nameEvidence) return null
    return {
      brawlhallaId,
      name: nameEvidence.name,
      aliases: aliasRows.map(({ display_alias }) => display_alias),
      bestLegendNameKey: rankedReference?.bestLegendNameKey ?? careerReference?.bestLegendNameKey,
      legacyRating: rankedReference?.legacyRating,
    }
  })
}
