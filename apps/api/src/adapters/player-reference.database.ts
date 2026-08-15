import type { Database } from '@brawltome/database'
import { getLegendById, legendSlug } from '@brawltome/game-data'
import { type CanonicalPlayerNameEvidence, selectCanonicalPlayerName } from '@brawltome/player'
import { createPlayerReferenceQueries } from '@brawltome/player/composition'
import { sql } from 'drizzle-orm'

type CanonicalReferenceEvidence = CanonicalPlayerNameEvidence & {
  brawlhallaId: number
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

type FindCanonicalReference = (brawlhallaId: number) => Promise<CanonicalReferenceEvidence | null>

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : null
}

function archivedReference(raw: unknown, brawlhallaId: number): CanonicalReferenceEvidence | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.name !== 'string') return null
  const bestLegend = positiveInteger(row.best_legend)
  const legend = bestLegend ? getLegendById(bestLegend) : undefined
  return {
    brawlhallaId,
    name: row.name,
    bestLegendNameKey: legend ? legendSlug(legend.heroId, legend.displayName) : null,
    legacyRating: positiveInteger(row.rating),
  }
}

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
    const archivedRows = nameEvidence
      ? []
      : await db.execute<{ raw_row: unknown }>(sql`
          SELECT raw_row FROM players.legacy_profile_archive WHERE brawlhalla_id = ${brawlhallaId}
        `)
    const archived = archivedReference(archivedRows[0]?.raw_row, brawlhallaId)
    const reference = nameEvidence ?? archived
    if (!reference) return null
    return {
      brawlhallaId,
      name: reference.name,
      aliases: aliasRows.map(({ display_alias }) => display_alias),
      bestLegendNameKey:
        rankedReference?.bestLegendNameKey ?? archived?.bestLegendNameKey ?? careerReference?.bestLegendNameKey,
      legacyRating: rankedReference?.legacyRating ?? archived?.legacyRating,
    }
  })
}
