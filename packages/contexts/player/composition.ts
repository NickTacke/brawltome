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

export {
  createPostgresCareerPlayers,
  type CanonicalCareerEffect,
  type PostgresCareerPlayers,
} from './career/postgres'
export { refreshCanonicalCareerPlayer, type V0CareerSource } from './career/refresh'
export type { CareerLegendResolver, CareerLegendReference } from './career/source'
export {
  createPostgresRankedPlayers,
  type CanonicalRankedEffect,
  type PostgresRankedPlayers,
} from './ranked/postgres'
export {
  refreshCanonicalRankedPlayer,
  refreshRankedPlayerPulse,
  type V0RankedSource,
  type V1RankedPulseSource,
} from './ranked/refresh'
export { createPlayerReferenceQueries, type FindStoredPlayerReference } from './player-reference.queries'
export {
  createPostgresPlayerDiscoverySource,
  type LegacyPlayerMigrationEvidence,
  type PostgresPlayerDiscoverySource,
} from './discovery-postgres'
export { createSteamPlayerEvidenceResolver } from './verification'
export { createPlayerRepo } from './player.repo'
export {
  importLegacyPlayerProfiles,
  type LegacyPlayerProfileImportOptions,
  type LegacyPlayerProfileImportResult,
} from './legacy-profile-import'
export {
  importLegacyPlayers,
  type LegacyPlayerImportOptions,
  type LegacyPlayerImportResult,
} from './legacy-import'

export const playerMigrationInventory = [
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
] as const
