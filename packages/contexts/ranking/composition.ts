import { initializeImmutable1v1Snapshots } from './migrations/0001-immutable-1v1-snapshots'

export {
  LeaderboardCandidateError,
  LeaderboardLeaseLostError,
  collectAndPublish1v1Generation,
  type LeaderboardGenerationCandidate,
  type LeaderboardPageSource,
  type RankingPublicationAuthorization,
  type RankingPublicationStore,
} from './leaderboard'
export { createPostgresRanking, type PostgresRanking } from './postgres'
export { fetch1v1LeaderboardPage } from './v1-leaderboard-source'

export const rankingMigrationInventory = [initializeImmutable1v1Snapshots] as const
