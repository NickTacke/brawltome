import { type ClanProfileContract, clanProfileSchema } from '@brawltome/contracts'
import type { ClanQueries } from '../db/postgres-clans'
import type { ClanMember, ClanProfile, ClanSectionState } from '../domain/clan-profile'
import type { ClanProvenance } from '../domain/provenance'

type SectionContract = ClanProfileContract['profile']
type ProvenanceContract = SectionContract['checkProvenance']
type MemberContract = ClanProfileContract['members'][number]

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

// the import evidence in a stored provenance is for operators, so only its source, outcome and legacy time go out
function toPublicProvenance(provenance: ClanProvenance): ProvenanceContract {
  const publicProvenance: ProvenanceContract = { source: provenance.source, outcome: provenance.outcome }

  if (provenance.legacyTimestamp) publicProvenance.legacyTimestamp = provenance.legacyTimestamp

  return publicProvenance
}

function toSectionContract(section: ClanSectionState): SectionContract {
  const lastSuccessProvenance = section.lastSuccessProvenance ? toPublicProvenance(section.lastSuccessProvenance) : null

  return {
    checkedAt: toIsoString(section.checkedAt),
    checkProvenance: toPublicProvenance(section.checkProvenance),
    lastSuccessAt: toIsoString(section.lastSuccessAt),
    lastSuccessProvenance,
  }
}

function toMemberContract(member: ClanMember): MemberContract {
  return { ...member, joinDate: toIsoString(member.joinDate) }
}

function toClanProfileContract(clan: ClanProfile): ClanProfileContract {
  const roster = clan.roster ? toSectionContract(clan.roster) : null

  return clanProfileSchema.parse({
    ...clan,
    clanCreateDate: clan.clanCreateDate.toISOString(),
    profile: toSectionContract(clan.profile),
    roster,
    members: clan.members.map(toMemberContract),
  })
}

/** A stored clan in its public shape, or null when its profile was never fetched. tRPC and oRPC both serve this. */
export async function readClanProfile(
  clans: Pick<ClanQueries, 'getById'>,
  clanId: number,
): Promise<ClanProfileContract | null> {
  const clan = await clans.getById(clanId)

  if (!clan) return null

  return toClanProfileContract(clan)
}
