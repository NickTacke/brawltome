import type { ClanProvenance } from './provenance'

/** When a section was last checked and last fetched successfully, and where each came from. */
export type ClanSectionState = {
  checkedAt: Date | null
  checkProvenance: ClanProvenance
  lastSuccessAt: Date | null
  lastSuccessProvenance: ClanProvenance | null
}

export type ClanMember = {
  brawlhallaId: number
  name: string | null
  rank: string | null
  joinDate: Date | null
  xp: string
  guildPoints: string | null
}

/** A stored clan as the API shows it. xp values are decimal strings, since they outgrow safe integers. */
export type ClanProfile = {
  clanId: number
  clanName: string
  clanCreateDate: Date
  clanXp: string
  clanLifetimeXp: string
  notice: string | null
  tags: string[] | null
  discordInviteCode: string | null
  guildPoints: string | null
  isRecruiting: boolean | null
  // a profile is only stored once it has been checked
  profile: ClanSectionState & { checkedAt: Date }
  // null until the roster is first checked
  roster: ClanSectionState | null
  members: ClanMember[]
}

export type PlayerClanMembership = {
  clanId: number
  clanName: string
  clanXp: string
  clanLifetimeXp: string
  personalXp: string
}
