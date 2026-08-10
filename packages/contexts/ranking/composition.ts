import { initializeImmutable1v1Snapshots } from './migrations/0001-immutable-1v1-snapshots'
import { addSupportedLeaderboardModes } from './migrations/0002-add-supported-modes'

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
export { fetchLeaderboardPage } from './v1-leaderboard-source'

export const rankingMigrationInventory = [initializeImmutable1v1Snapshots, addSupportedLeaderboardModes] as const
