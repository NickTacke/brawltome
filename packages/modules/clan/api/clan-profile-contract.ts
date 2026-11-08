import { type ClanProfileContract, clanProfileSchema } from '@brawltome/contracts'
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

/** A stored clan in its public shape: dates as ISO text, and provenance without the operator-only import evidence. */
export function toClanProfileContract(clan: ClanProfile): ClanProfileContract {
  const roster = clan.roster ? toSectionContract(clan.roster) : null

  return clanProfileSchema.parse({
    ...clan,
    clanCreateDate: clan.clanCreateDate.toISOString(),
    profile: toSectionContract(clan.profile),
    roster,
    members: clan.members.map(toMemberContract),
  })
}
