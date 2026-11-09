import type { ClanProfileContract, PlayerRankedSummaryContract } from '@brawltome/contracts'
import { fixEncoding } from '../../lib'

export type Member = ClanProfileContract['members'][number]
export type RoleGroup = 'leader' | 'officer' | 'member' | 'recruit'
export type RoleFilter = RoleGroup | 'all'
export type SortKey = 'xp' | 'elo' | 'name' | 'role' | 'joined'
export type RosterSort = { key: SortKey; descending: boolean }
export type RankedMember = Member & {
  placement: number
  displayName: string
  roleGroup: RoleGroup
  mainLegend: string | null
  elo: number | null
}

export const roleGroups: { group: RoleGroup; label: string }[] = [
  { group: 'leader', label: 'Leader' },
  { group: 'officer', label: 'Officers' },
  { group: 'member', label: 'Members' },
  { group: 'recruit', label: 'Recruits' },
]

const roleOrder: Record<RoleGroup, number> = { leader: 4, officer: 3, member: 2, recruit: 1 }

function toRoleGroup(role: string | null): RoleGroup {
  const normalizedRole = role?.toLowerCase()

  if (normalizedRole === 'leader' || normalizedRole === 'officer' || normalizedRole === 'recruit') return normalizedRole

  return 'member'
}

// xp and points are decimal strings that can pass the safe integer range
function compareDecimal(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)

  if (leftValue === rightValue) return 0

  return leftValue < rightValue ? -1 : 1
}

function displayNameOf(member: Member): string {
  return fixEncoding(member.name).trim() || `Player ${member.brawlhallaId}`
}

/** Every member with their XP placement in the guild, highest first. */
export function rankMembers(members: Member[], summaries: PlayerRankedSummaryContract[]): RankedMember[] {
  const summaryById = new Map(summaries.map((summary) => [summary.brawlhallaId, summary]))
  const byXp = [...members].sort((left, right) => compareDecimal(right.xp, left.xp))

  return byXp.map((member, index) => {
    const summary = summaryById.get(member.brawlhallaId)

    return {
      ...member,
      placement: index + 1,
      displayName: displayNameOf(member),
      roleGroup: toRoleGroup(member.rank),
      mainLegend: summary?.mainLegend ?? null,
      elo: summary?.rating ?? null,
    }
  })
}

export function countByRole(members: RankedMember[]): Record<RoleGroup, number> {
  const counts: Record<RoleGroup, number> = { leader: 0, officer: 0, member: 0, recruit: 0 }

  for (const member of members) counts[member.roleGroup] += 1

  return counts
}

/** At most three members by guild points, ties going to the higher XP placement. */
export function topContributors(members: RankedMember[]): RankedMember[] {
  const sorted = [...members].sort((left, right) => {
    const byPoints = compareDecimal(right.guildPoints ?? '0', left.guildPoints ?? '0')

    return byPoints || left.placement - right.placement
  })

  return sorted.slice(0, 3)
}

export function filterMembers(members: RankedMember[], role: RoleFilter, search: string): RankedMember[] {
  const needle = search.trim().toLowerCase()

  return members.filter((member) => {
    const matchesRole = role === 'all' || member.roleGroup === role

    const matchesSearch =
      member.displayName.toLowerCase().includes(needle) || String(member.brawlhallaId).includes(needle)

    return matchesRole && matchesSearch
  })
}

function joinedTime(member: RankedMember): number {
  return member.joinDate ? new Date(member.joinDate).getTime() : Number.POSITIVE_INFINITY
}

function compareMembers(left: RankedMember, right: RankedMember, key: SortKey): number {
  if (key === 'name') return left.displayName.localeCompare(right.displayName)

  if (key === 'joined') return joinedTime(left) - joinedTime(right)

  if (key === 'elo') return (left.elo ?? -1) - (right.elo ?? -1)

  if (key === 'role') return roleOrder[left.roleGroup] - roleOrder[right.roleGroup] || right.placement - left.placement

  return right.placement - left.placement
}

export function sortMembers(members: RankedMember[], sort: RosterSort): RankedMember[] {
  const direction = sort.descending ? -1 : 1

  return [...members].sort((left, right) => direction * compareMembers(left, right, sort.key))
}
