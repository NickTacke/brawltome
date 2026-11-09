import type { BrawltomeModule } from '@brawltome/foundation'
import { createClanProcedures } from './api/procedures'
import { initializeClans } from './migrations/0001-initialize-clans'
import { addClanDiscoveryFacts } from './migrations/0002-add-discovery-facts'
import { addV2ClanImportEvidence } from './migrations/0003-add-v2-import-evidence'
import { allowSparseClanMembers } from './migrations/0004-allow-sparse-members'

export { toClanProfileContract } from './api/clan-profile-contract'
export { readClanProfile } from './api/read-clan-profile'
export { readPlayerClanMembership } from './api/read-player-clan-membership'
export { createPostgresClanDiscoverySource } from './db/postgres-clan-discovery-source'
export { type ClanQueries, createPostgresClans } from './db/postgres-clans'
export type { ClanProvenance } from './domain/provenance'
export { clanRefreshContract } from './jobs/clan-refresh-contract'
export {
  type ClanRefreshJobDependencies,
  createClanRefreshJob,
} from './jobs/clan-refresh-job'
export {
  type ClanRefreshReservations,
  createClanRefreshReservations,
  reserveClanRefresh,
} from './jobs/clan-refresh-reservation'
export type { ClanSource } from './jobs/refresh-clan'

const migrations = [initializeClans, addClanDiscoveryFacts, addV2ClanImportEvidence, allowSparseClanMembers] as const

export const clanModule = {
  // a literal, so the API router can serve the procedures under this name with their types
  name: 'clan' as const,
  dependsOn: ['queue'],
  migrations,
  routes: createClanProcedures,
} satisfies BrawltomeModule
