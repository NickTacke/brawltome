import type { BrawltomeModule } from '@brawltome/foundation'
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
  defaultLeaderboardIntervalMs,
  defaultLeaderboardPageDepth,
  leaderboardDeepCrawlStandings,
  leaderboardDeepCrawlTeams,
  leaderboardModeFromOperationKind,
  maxLeaderboardPageDepth,
  type LeaderboardDeepCrawlStanding,
  type LeaderboardDeepCrawlTeam,
  type LeaderboardGenerationCandidate,
  type LeaderboardPageSource,
  type LeaderboardScope,
  type LeaderboardView,
  type PlayerValhallanEvidence,
  type PlayerValhallanQueries,
  type PublishedLeaderboardRow,
  type RankingPublicationAuthorization,
  type RankingPublicationStore,
  type RankingQueries,
  type RecentActivityEntry,
  type RecentActivityView,
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
  LeaderboardSourceError,
  fetchLeaderboardPage,
  leaderboardModes,
  regionalLeaderboardScopes,
  type LeaderboardMode,
  type RegionalLeaderboardScope,
} from './v1-leaderboard-source'

const migrations = [
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

// leaderboard publication and retention fence their writes with refresh_operations lease functions
export const rankingModule = {
  name: 'ranking',
  dependsOn: ['refresh-operations'],
  migrations,
} satisfies BrawltomeModule
