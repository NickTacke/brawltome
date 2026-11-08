import type { BrawltomeModule } from '@brawltome/foundation'
import { initializeClans } from './migrations/0001-initialize-clans'
import { addClanDiscoveryFacts } from './migrations/0002-add-discovery-facts'
import { addV2ClanImportEvidence } from './migrations/0003-add-v2-import-evidence'
import { allowSparseClanMembers } from './migrations/0004-allow-sparse-members'

export type {
  ClanDiscoveryEvent,
  ClanDiscoveryFact,
  ClanDiscoverySnapshot,
  ClanDiscoverySource,
} from './discovery-facts'
export { createPostgresClanDiscoverySource, type PostgresClanDiscoverySource } from './discovery-postgres'
export {
  type ClanRefreshResult,
  type ClanSource,
  processRefreshClan,
  processRefreshClanSection,
} from './jobs/refresh-clan'
export {
  type ClanProvenance,
  type ClanQueries,
  type ClanRefreshEffect,
  createPostgresClans,
  type PostgresClans,
} from './postgres'
export { getClan } from './queries/get-clan'

const migrations = [initializeClans, addClanDiscoveryFacts, addV2ClanImportEvidence, allowSparseClanMembers] as const

export const clanModule = {
  name: 'clan',
  dependsOn: [],
  migrations,
} satisfies BrawltomeModule
