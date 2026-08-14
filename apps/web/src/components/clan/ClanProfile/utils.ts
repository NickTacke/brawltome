export interface ClanMember {
  brawlhallaId: number
  name: string | null
  xp: string
  guildPoints: string | null
  rank: string | null
  joinDate: string | null
}

export type SortKey = 'default' | 'xp'

const RANK_VALUES: Record<string, number> = {
  leader: 4,
  officer: 3,
  member: 2,
  recruit: 1,
}

export function getRankValue(rank: string | null): number {
  return rank ? (RANK_VALUES[rank.toLowerCase()] ?? 0) : 0
}

export function paginateMembers<T>(members: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return members.slice(start, start + pageSize)
}

export function filterMembers<T extends { name: string | null; brawlhallaId: number }>(
  members: T[],
  searchTerm: string,
): T[] {
  if (!searchTerm) return members
  const needle = searchTerm.toLowerCase()
  return members.filter(
    (member) => member.name?.toLowerCase().includes(needle) || String(member.brawlhallaId).includes(searchTerm),
  )
}

export function sortMembers<T extends { rank: string | null; xp: string; joinDate: string | null }>(
  members: T[],
  sortKey: SortKey,
): T[] {
  const copy = [...members]
  if (sortKey === 'xp') {
    return copy.sort((a, b) => {
      const left = BigInt(a.xp)
      const right = BigInt(b.xp)
      return left === right ? 0 : left > right ? -1 : 1
    })
  }
  return copy.sort((a, b) => {
    const rankDiff = getRankValue(b.rank) - getRankValue(a.rank)
    if (rankDiff !== 0) return rankDiff
    const left = a.joinDate ? new Date(a.joinDate).getTime() : Number.POSITIVE_INFINITY
    const right = b.joinDate ? new Date(b.joinDate).getTime() : Number.POSITIVE_INFINITY
    return left - right
  })
}
