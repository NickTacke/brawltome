import type { Database } from '@brawltome/foundation'
import { createPostgresCareerPlayers } from './career/postgres'
import { decodeV0CareerNameCandidate } from './career/source'
import { createPostgresLeaderboardPlayerNames } from './leaderboard-names'
import { createPostgresRankedPlayers } from './ranked/postgres'
import {
  type CanonicalPlayerNameEvidence,
  isUsablePlayerName,
  type PlayerReference,
  type PlayerReferenceQueries,
  selectCanonicalPlayerName,
} from './reference'

export function createPostgresPlayerReferences(database: Database): PlayerReferenceQueries {
  const ranked = createPostgresRankedPlayers(database)
  const career = createPostgresCareerPlayers(database)
  const leaderboardNames = createPostgresLeaderboardPlayerNames(database)

  return {
    async byId(brawlhallaId) {
      const [rankedReference, careerReference, leaderboardReference, storedAliases] = await Promise.all([
        ranked.referenceById(brawlhallaId),
        career.referenceById(brawlhallaId),
        leaderboardNames.referenceById(brawlhallaId),
        readAliases(database, brawlhallaId),
      ])

      const nameEvidence = selectCanonicalPlayerName<CanonicalPlayerNameEvidence>({
        brawlhallaId,
        ranked: rankedReference,
        career: careerReference,
        leaderboard: leaderboardReference,
      })

      if (!nameEvidence) return null

      const reference: PlayerReference = {
        brawlhallaId,
        name: nameEvidence.name,
        aliases: usableAliases(storedAliases, nameEvidence.name, brawlhallaId),
      }

      const bestLegendNameKey = rankedReference?.bestLegendNameKey ?? careerReference?.bestLegendNameKey

      if (bestLegendNameKey !== undefined) reference.bestLegendNameKey = bestLegendNameKey

      if (rankedReference) reference.legacyRating = rankedReference.legacyRating

      return reference
    },
  }
}

// one alias per normalized spelling, the current one before the legacy import's, newest first
async function readAliases(database: Database, brawlhallaId: number): Promise<string[]> {
  const rows = await database.sql<{ display_alias: string }[]>`
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
  `

  return rows.map(({ display_alias }) => display_alias)
}

// drops the name itself, its mojibake spelling and names no player could have
function usableAliases(aliases: string[], name: string, brawlhallaId: number): string[] {
  const usable = aliases.filter(
    (alias) =>
      alias.toLowerCase() !== name.toLowerCase() &&
      decodeV0CareerNameCandidate(alias) !== name &&
      isUsablePlayerName(alias, brawlhallaId),
  )

  return [...new Set(usable)]
}
