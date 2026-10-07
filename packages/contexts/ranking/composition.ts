import { initializeImmutable1v1Snapshots } from './migrations/0001-immutable-1v1-snapshots'
import { addSupportedLeaderboardModes } from './migrations/0002-add-supported-modes'
import { addV2LegacyRankingImport } from './migrations/0003-add-v2-legacy-import'
import { addLeaderboardProviderCompatibility } from './migrations/0004-add-provider-compatibility'
import { indexLegacyRankingEvaluation } from './migrations/0005-index-legacy-evaluation'
import { supportCouchLeaderboardTeams } from './migrations/0006-support-couch-teams'
import { allowEmptyRegionalLeaderboardSnapshots } from './migrations/0007-allow-empty-regional-snapshots'
import { dropRedundantSnapshotRowIndexes } from './migrations/0008-drop-redundant-snapshot-row-indexes'
import { expireV1RankingGenerations } from './migrations/0009-expire-v1-generations'
import { bitmapRetentionDelete } from './migrations/0010-bitmap-retention-delete'
import { retentionDeleteWithoutSeqScan } from './migrations/0011-retention-delete-without-seqscan'
import { statementLevelRowImmutability } from './migrations/0012-statement-level-row-immutability'

export {
  LeaderboardCandidateError,
  LeaderboardLeaseLostError,
  collectAndPublishLeaderboardGeneration,
  leaderboardDeepCrawlStandings,
  leaderboardDeepCrawlTeams,
  leaderboardModeFromOperationKind,
  type LeaderboardDeepCrawlStanding,
  type LeaderboardDeepCrawlTeam,
  type LeaderboardGenerationCandidate,
  type LeaderboardPageSource,
  type RankingPublicationAuthorization,
  type RankingPublicationStore,
} from './leaderboard'
export { createPostgresRanking, type PostgresRanking } from './postgres'
export {
  maxRankingRetentionBatch,
  maxRankingRetentionHours,
  minRankingRetentionHours,
  type RankingRetentionAuthorization,
  type RankingRetentionInput,
  type RankingRetentionResult,
  type RankingRetentionStore,
} from './retention'
export {
  importLegacyRankings,
  type LegacyRankingImportOptions,
  type LegacyRankingImportResult,
  type LegacyRankingMigrationEntryEvidence,
  type LegacyRankingMigrationEvidence,
  type LegacyRankingMigrationSetEvidence,
  readLegacyRankingMigrationEvidence,
} from './legacy-import'
export { LeaderboardSourceError, fetchLeaderboardPage } from './v1-leaderboard-source'

export const rankingMigrationInventory = [
  initializeImmutable1v1Snapshots,
  addSupportedLeaderboardModes,
  addV2LegacyRankingImport,
  addLeaderboardProviderCompatibility,
  indexLegacyRankingEvaluation,
  supportCouchLeaderboardTeams,
  allowEmptyRegionalLeaderboardSnapshots,
  dropRedundantSnapshotRowIndexes,
  expireV1RankingGenerations,
  bitmapRetentionDelete,
  retentionDeleteWithoutSeqScan,
  statementLevelRowImmutability,
] as const
