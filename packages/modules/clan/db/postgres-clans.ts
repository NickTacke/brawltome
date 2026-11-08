import type { Database } from '@brawltome/foundation'
import type { ClanMemberWrite } from '../domain/guild-members'
import type { ClanProfileWrite } from '../domain/guild-stats'
import type { ClanProvenance } from '../domain/provenance'
import type { ClanRefreshEffect } from '../domain/refresh-effect'
import { getClanProfile } from './get-clan-profile'
import { getPlayerMembership } from './get-player-membership'
import { prepareRefreshEffect } from './prepare-refresh-effect'
import { publishProfile } from './publish-profile'
import { publishRoster } from './publish-roster'
import { recordProfileCheck } from './record-profile-check'
import { recordRosterCheck } from './record-roster-check'
import { revokeRefreshEffect } from './revoke-refresh-effect'

/** The clan use cases bound to one database, in the shape the api and the operations worker call today. */
export function createPostgresClans(database: Database) {
  return {
    prepareRefreshEffect: (effect: ClanRefreshEffect) => prepareRefreshEffect(database, effect),

    revokeRefreshEffect: (effect: ClanRefreshEffect) => revokeRefreshEffect(database, effect),

    getById: (clanId: number) => getClanProfile(database, clanId),

    getPlayerMembership: (brawlhallaId: number) => getPlayerMembership(database, brawlhallaId),

    publishProfile: (
      profile: ClanProfileWrite,
      checkedAt: Date,
      provenance: ClanProvenance,
      effect?: ClanRefreshEffect,
    ) => publishProfile(database, { profile, checkedAt, provenance, effect }),

    recordProfileCheck: (clanId: number, checkedAt: Date, provenance: ClanProvenance, effect?: ClanRefreshEffect) =>
      recordProfileCheck(database, { clanId, checkedAt, provenance, effect }),

    publishRoster: (
      clanId: number,
      members: ClanMemberWrite[],
      checkedAt: Date,
      provenance: ClanProvenance,
      effect?: ClanRefreshEffect,
    ) => publishRoster(database, { clanId, members, checkedAt, provenance, effect }),

    recordRosterCheck: (clanId: number, checkedAt: Date, provenance: ClanProvenance, effect?: ClanRefreshEffect) =>
      recordRosterCheck(database, { clanId, checkedAt, provenance, effect }),
  }
}

export type PostgresClans = ReturnType<typeof createPostgresClans>
export type ClanQueries = Pick<PostgresClans, 'getById' | 'getPlayerMembership'>

export function getClan(clans: ClanQueries, clanId: number) {
  return clans.getById(clanId)
}
