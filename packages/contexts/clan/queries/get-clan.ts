import type { ClanRepo } from '../clan.repo'

export async function getClan(repo: ClanRepo, clanId: number) {
  const c = await repo.findById(clanId)
  if (!c) return null

  const memberIds = c.members.map((m) => m.brawlhallaId)
  const playerMap = await repo.getMemberRatings(memberIds)

  const members = c.members.map((m) => ({
    ...m,
    rating: playerMap.get(m.brawlhallaId)?.rating ?? 0,
    peakRating: playerMap.get(m.brawlhallaId)?.peakRating ?? 0,
  }))

  return { ...c, members }
}
