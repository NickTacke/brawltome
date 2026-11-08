import type { BrawltomeModule } from '@brawltome/foundation'
import { initializePlayersSchema } from './migrations/0001-initialize-schema'
import { addInteractiveRefreshEffects } from './migrations/0002-add-interactive-refresh-effects'
import { addCanonicalRankedState } from './migrations/0003-add-canonical-ranked-state'
import { addCanonicalCareerState } from './migrations/0004-add-canonical-career-state'
import { addDiscoveryFacts } from './migrations/0005-add-discovery-facts'
import { addRankedPulseOverlays } from './migrations/0006-add-ranked-pulse-overlays'
import { addV2PlayerImport } from './migrations/0007-add-v2-player-import'
import { addLegacyBestLegend } from './migrations/0008-add-legacy-best-legend'
import { addCareerGuild } from './migrations/0009-add-career-guild'
import { allowRankedWithoutIdentity } from './migrations/0010-allow-ranked-without-identity'
import { reconcileCareerNameMojibake } from './migrations/0011-reconcile-career-name-mojibake'
import { addHistoricalCareerSource } from './migrations/0012-add-historical-career-source'
import { addCompactReferenceImport } from './migrations/0013-add-compact-reference-import'
import { addLeaderboardNameObservations } from './migrations/0014-add-leaderboard-name-observations'
import { addNameVerifications } from './migrations/0015-add-name-verifications'
import { addCareerLegendsBestOrderIndex } from './migrations/0016-add-career-legends-best-order-index'
import { addLeaderboardRankedObservations } from './migrations/0017-add-leaderboard-ranked-observations'
import { addProfileViewDays } from './migrations/0018-add-profile-view-days'
import { addLeaderboardTeamModeObservations } from './migrations/0019-add-leaderboard-team-mode-observations'
import { addLeaderboardTeamObservationsSecondPlayerIndex } from './migrations/0020-add-leaderboard-team-observations-second-player-index'
import { movePrimaryMonitoringWatermark } from './migrations/0021-move-primary-monitoring-watermark'
import { dropPrimaryMonitoringWatermarkView } from './migrations/0022-drop-primary-monitoring-watermark-view'

export {
  CAREER_FRESHNESS_SECONDS,
  type CareerPlayerProfile,
  type CareerPlayerQueries,
  type CareerSnapshot,
  type CareerSnapshotSource,
  careerFreshness,
} from './career/model'
export {
  type CanonicalCareerEffect,
  createPostgresCareerPlayers,
  type PostgresCareerPlayers,
} from './career/postgres'
export { refreshCanonicalCareerPlayer, type V0CareerSource } from './career/refresh'
export type { CareerLegendReference, CareerLegendResolver } from './career/source'
export type {
  PlayerDiscoveryEvent,
  PlayerDiscoveryFact,
  PlayerDiscoverySnapshot,
  PlayerDiscoverySnapshotStream,
  PlayerDiscoverySource,
} from './discovery-facts'
export {
  createPostgresPlayerDiscoverySource,
  type PostgresPlayerDiscoverySource,
} from './discovery-postgres'
export { createPostgresPlayerFreshness, type PostgresPlayerFreshness } from './freshness'
export {
  createInteractivePlayerRefreshJob,
  type InteractivePlayerRefreshJobDependencies,
} from './jobs/interactive-player-refresh-job'
export {
  createPlayerNameVerificationJob,
  type PlayerNameVerificationJobDependencies,
  type PlayerNameVerificationPayload,
} from './jobs/player-name-verification-job'
export {
  createPlayerRefreshReservations,
  type PlayerRefreshReservations,
} from './jobs/player-refresh-reservation'
export {
  type PrimaryMonitoringSnapshot,
  reconcilePrimaryMonitoring,
} from './jobs/primary-monitoring-schedules'
export { createRankedPlayerPulseJob } from './jobs/ranked-player-pulse-job'
export {
  createRecentlyViewedRefreshes,
  type FreshnessAttempt,
  type RefreshRequestDemand,
} from './jobs/recently-viewed-refreshes'
export {
  createPostgresLeaderboardPlayerNames,
  type LeaderboardPlayerName,
  type PostgresLeaderboardPlayerNames,
} from './leaderboard-names'
export {
  createPostgresLeaderboardRanked,
  type LeaderboardRankedObservation,
  type LeaderboardRankedStanding,
  type LeaderboardTeamObservation,
  type PostgresLeaderboardRanked,
} from './leaderboard-ranked'
export {
  createPostgresPlayerNameVerifications,
  type NameVerificationBacklog,
  type NameVerificationCandidate,
  type NameVerificationOutcome,
  type NameVerificationPolicy,
  type NameVerificationPreparation,
  type PostgresPlayerNameVerifications,
} from './name-verification'
export { createPostgresPlayerReferences } from './player-references'
export {
  createPostgresProfileViews,
  type PostgresProfileViews,
  type ProfileViewDemand,
} from './profile-views'
export {
  type MainLegend,
  RANKED_FRESHNESS_SECONDS,
  type RankedPlayerProfile,
  type RankedPlayerQueries,
  type RankedSnapshot,
  rankedFreshness,
} from './ranked/model'
export {
  type CanonicalRankedEffect,
  createPostgresRankedPlayers,
  type PostgresRankedPlayers,
} from './ranked/postgres'
export {
  refreshCanonicalRankedPlayer,
  refreshRankedPlayerPulse,
  type V0RankedSource,
  type V1RankedPulseSource,
} from './ranked/refresh'
export {
  type CanonicalPlayerNameEvidence,
  isUsablePlayerName,
  type PlayerReference,
  type PlayerReferenceQueries,
  selectCanonicalPlayerName,
} from './reference'
export {
  createSteamPlayerEvidenceResolver,
  type SteamPlayerEvidence,
  type SteamPlayerEvidenceResolver,
} from './verification'

const migrations = [
  initializePlayersSchema,
  addInteractiveRefreshEffects,
  addCanonicalRankedState,
  addCanonicalCareerState,
  addDiscoveryFacts,
  addRankedPulseOverlays,
  addV2PlayerImport,
  addLegacyBestLegend,
  addCareerGuild,
  allowRankedWithoutIdentity,
  reconcileCareerNameMojibake,
  addHistoricalCareerSource,
  addCompactReferenceImport,
  addLeaderboardNameObservations,
  addNameVerifications,
  addCareerLegendsBestOrderIndex,
  addLeaderboardRankedObservations,
  addProfileViewDays,
  addLeaderboardTeamModeObservations,
  addLeaderboardTeamObservationsSecondPlayerIndex,
  movePrimaryMonitoringWatermark,
  dropPrimaryMonitoringWatermarkView,
] as const

export const playerModule = {
  name: 'player',
  dependsOn: ['refresh-operations'],
  migrations,
} satisfies BrawltomeModule
