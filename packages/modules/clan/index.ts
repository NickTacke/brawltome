import type { BrawltomeModule } from '@brawltome/foundation'
import { createClanProcedures } from './api/procedures'
import { initializeClans } from './migrations/0001-initialize-clans'
import { addClanDiscoveryFacts } from './migrations/0002-add-discovery-facts'
import { addV2ClanImportEvidence } from './migrations/0003-add-v2-import-evidence'
import { allowSparseClanMembers } from './migrations/0004-allow-sparse-members'

export { toClanProfileContract } from './api/clan-profile-contract'
export { readClanProfile } from './api/read-clan-profile'
export { type PublicClanMembership, readPlayerClanMembership } from './api/read-player-clan-membership'
export { getClanProfile } from './db/get-clan-profile'
export { getPlayerMembership } from './db/get-player-membership'
export {
  createPostgresClanDiscoverySource,
  type PostgresClanDiscoverySource,
} from './db/postgres-clan-discovery-source'
export { type ClanQueries, createPostgresClans, getClan, type PostgresClans } from './db/postgres-clans'
export type { ClanMember, ClanProfile, ClanSectionState, PlayerClanMembership } from './domain/clan-profile'
export type {
  ClanDiscoveryEvent,
  ClanDiscoveryFact,
  ClanDiscoverySnapshot,
  ClanDiscoverySource,
} from './domain/discovery-facts'
export type { ClanProvenance } from './domain/provenance'
export type { ClanRefreshEffect } from './domain/refresh-effect'
export {
  type ClanRefreshResult,
  type ClanSource,
  processRefreshClan,
  processRefreshClanSection,
} from './jobs/refresh-clan'

const migrations = [initializeClans, addClanDiscoveryFacts, addV2ClanImportEvidence, allowSparseClanMembers] as const

export const clanModule = {
  // a literal, so the API router can serve the procedures under this name with their types
  name: 'clan' as const,
  dependsOn: [],
  migrations,
  routes: createClanProcedures,
} satisfies BrawltomeModule
