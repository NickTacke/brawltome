import { initializeImmutable1v1Snapshots } from './migrations/0001-immutable-1v1-snapshots'
import { addSupportedLeaderboardModes } from './migrations/0002-add-supported-modes'
import { addV2LegacyRankingImport } from './migrations/0003-add-v2-legacy-import'

export {
  LeaderboardCandidateError,
  LeaderboardLeaseLostError,
  collectAndPublishLeaderboardGeneration,
  leaderboardModeFromOperationKind,
  type LeaderboardGenerationCandidate,
  type LeaderboardPageSource,
  type RankingPublicationAuthorization,
  type RankingPublicationStore,
} from './leaderboard'
export { createPostgresRanking, type PostgresRanking } from './postgres'
export {
  importLegacyRankings,
  type LegacyRankingImportOptions,
  type LegacyRankingImportResult,
  type LegacyRankingMigrationEntryEvidence,
  type LegacyRankingMigrationEvidence,
  type LegacyRankingMigrationSetEvidence,
  readLegacyRankingMigrationEvidence,
} from './legacy-import'
export { fetchLeaderboardPage } from './v1-leaderboard-source'

export const rankingMigrationInventory = [
  initializeImmutable1v1Snapshots,
  addSupportedLeaderboardModes,
  addV2LegacyRankingImport,
] as const
