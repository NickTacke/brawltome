import type { BrawltomeModule } from '@brawltome/foundation'
import { createRankingProcedures } from './api/procedures'
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
import { moveEffectTables } from './migrations/0013-move-effect-tables'
import { dropEffectTableCompatibility } from './migrations/0014-drop-effect-table-compatibility'

export { enrichLeaderboardEntries } from './api/enrich-leaderboard-entries'
export { readNamedLeaderboard } from './api/read-named-leaderboard'
export { readAppliedLeaderboardEffects } from './db/leaderboard-effects'
export { createLeaderboardDeepCrawlProgress } from './jobs/deep-crawl-progress'
export {
  createLeaderboardCollectionJob,
  type LeaderboardCollectionJobDependencies,
} from './jobs/leaderboard-collection-job'
export {
  createLeaderboardDeepCrawlJob,
  defaultDeepCrawlSlicePages,
  type LeaderboardDeepCrawlJobDependencies,
} from './jobs/leaderboard-deep-crawl-job'
export { leaderboardCollectionContract, leaderboardDeepCrawlContract } from './jobs/leaderboard-job-contracts'
export {
  disableLeaderboardDeepCrawlSchedule,
  reconcileLeaderboardDeepCrawlSchedule,
  reconcileLeaderboardSchedule,
} from './jobs/leaderboard-schedules'
export { rankingRetentionContract } from './jobs/ranking-retention-contract'
export { createRankingRetentionJob, type RankingRetentionJobDependencies } from './jobs/ranking-retention-job'
export { disableRankingRetentionSchedule, reconcileRankingRetentionSchedule } from './jobs/retention-schedule'
export {
  collectAndPublishLeaderboardGeneration,
  defaultLeaderboardIntervalMs,
  defaultLeaderboardPageDepth,
  LeaderboardCandidateError,
  type LeaderboardDeepCrawlStanding,
  type LeaderboardDeepCrawlTeam,
  type LeaderboardGenerationCandidate,
  LeaderboardLeaseLostError,
  type LeaderboardPageSource,
  type LeaderboardScope,
  type LeaderboardView,
  leaderboardDeepCrawlStandings,
  leaderboardDeepCrawlTeams,
  leaderboardModeFromOperationKind,
  maxLeaderboardPageDepth,
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
  fetchLeaderboardPage,
  type LeaderboardMode,
  LeaderboardSourceError,
  leaderboardModes,
  type RegionalLeaderboardScope,
  regionalLeaderboardScopes,
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
  moveEffectTables,
  dropEffectTableCompatibility,
] as const

export const rankingModule = {
  // a literal, so the API router can serve the procedures under this name with their types
  name: 'ranking' as const,
  dependsOn: ['queue', 'player'],
  migrations,
  routes: createRankingProcedures,
} satisfies BrawltomeModule
