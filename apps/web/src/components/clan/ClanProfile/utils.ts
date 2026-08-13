export interface ClanMember {
  brawlhallaId: number
  name: string
  xp: string
  guildPoints: string | null
  rank: string
  joinDate: string
}

export type SortKey = 'default' | 'xp'

const RANK_VALUES: Record<string, number> = {
  leader: 4,
  officer: 3,
  member: 2,
  recruit: 1,
}

export function getRankValue(rank: string): number {
  return RANK_VALUES[rank.toLowerCase()] ?? 0
}

export function paginateMembers<T>(members: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return members.slice(start, start + pageSize)
}

export function filterMembers<T extends { name: string; brawlhallaId: number }>(members: T[], searchTerm: string): T[] {
  if (!searchTerm) return members
  const needle = searchTerm.toLowerCase()
  return members.filter((m) => m.name.toLowerCase().includes(needle) || String(m.brawlhallaId).includes(searchTerm))
}

export function sortMembers<T extends { rank: string; xp: string; joinDate: string }>(
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
    return new Date(a.joinDate).getTime() - new Date(b.joinDate).getTime()
  })
}
