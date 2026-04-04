import type { ClanRepo } from '@brawltome/clan'
import type { PlayerRepo } from '@brawltome/player'
import { getLegendById } from '@brawltome/shared'
import type { RankingRepo } from '../ranking.repo'

function sanitizeQuery(query: string): string {
  return query
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/[%\\]/g, '')
    .trim()
}

export async function searchLocal(
  deps: { rankingRepo: RankingRepo; playerRepo: PlayerRepo; clanRepo: ClanRepo },
  rawQuery: string,
) {
  const query = sanitizeQuery(rawQuery)
  if (query.length < 2) return { players: [], clans: [] }

  const blacklistSet = await deps.rankingRepo.getBlacklistedIds()

  const playersByName = await deps.playerRepo.searchPlayersByName(query, blacklistSet)

  const aliasMatches = await deps.playerRepo.searchPlayersByAlias(query)
  const aliasIds = aliasMatches
    .map((a) => a.brawlhallaId)
    .filter((id) => !blacklistSet.has(id) && !playersByName.some((p) => p.brawlhallaId === id))

  let playersByAlias: typeof playersByName = []
  if (aliasIds.length > 0) {
    playersByAlias = await deps.playerRepo.getPlayersByIds(aliasIds)
  }

  const players = [...playersByName, ...playersByAlias].slice(0, 40).map((p) => ({
    ...p,
    bestLegendNameKey: p.bestLegend != null ? (getLegendById(p.bestLegend)?.legendNameKey ?? null) : null,
  }))

  const clans = await deps.clanRepo.searchClans(query)

  return { players, clans }
}
