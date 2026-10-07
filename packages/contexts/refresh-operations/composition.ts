import { initializeRefreshOperations } from './migrations/0001-initialize-operations'
import { addSchedulingAndAdmission } from './migrations/0002-add-scheduling-and-admission'
import { addInteractiveRefreshReservations } from './migrations/0003-interactive-refresh-reservations'
import { addInteractiveRefreshCheckpoints } from './migrations/0004-add-interactive-checkpoints'
import { addLeaderboardOperationKind } from './migrations/0005-add-leaderboard-kind'
import { exposeActiveLeaseFence } from './migrations/0006-expose-active-lease-fence'
import { addClanRefresh } from './migrations/0007-add-clan-refresh'
import { addDeadLetterOperations } from './migrations/0008-add-dead-letter-operations'
import { addLeaderboardOperationModes } from './migrations/0009-add-leaderboard-modes'
import { addPlayerDiscoveryProjection } from './migrations/0010-add-player-discovery-projection'
import { addRankedPlayerPulseOperation } from './migrations/0011-add-ranked-player-pulse'
import { addPrimaryPlayerMonitoring } from './migrations/0012-add-primary-player-monitoring'
import { addDiscoveryOperations } from './migrations/0013-add-discovery-operations'
import { addStatisticsCollection } from './migrations/0014-add-statistics-collection'
import { addStatisticsPublication } from './migrations/0015-add-statistics-publication'
import { addLegendMetaPublication } from './migrations/0016-add-legend-meta-publication'
import { addPlayerNameVerification } from './migrations/0017-add-player-name-verification'
import { addRankingRetention } from './migrations/0018-add-ranking-retention'
import { validateRankingRetentionChecks } from './migrations/0019-validate-ranking-retention-checks'
import { allowRecentlyViewedRefresh } from './migrations/0020-allow-recently-viewed-refresh'
import { validateRecentlyViewedRefresh } from './migrations/0021-validate-recently-viewed-refresh'

export {
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  type PostgresRefreshOperations,
} from './postgres'

export const refreshOperationsMigrationInventory = [
  initializeRefreshOperations,
  addSchedulingAndAdmission,
  addInteractiveRefreshReservations,
  addInteractiveRefreshCheckpoints,
  addLeaderboardOperationKind,
  exposeActiveLeaseFence,
  addClanRefresh,
  addDeadLetterOperations,
  addLeaderboardOperationModes,
  addPlayerDiscoveryProjection,
  addRankedPlayerPulseOperation,
  addPrimaryPlayerMonitoring,
  addDiscoveryOperations,
  addStatisticsCollection,
  addStatisticsPublication,
  addLegendMetaPublication,
  addPlayerNameVerification,
  addRankingRetention,
  validateRankingRetentionChecks,
  allowRecentlyViewedRefresh,
  validateRecentlyViewedRefresh,
] as const
