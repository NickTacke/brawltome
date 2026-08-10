import type { ClanQueries } from '../postgres'

export function getClan(clans: ClanQueries, clanId: number) {
  return clans.getById(clanId)
}
