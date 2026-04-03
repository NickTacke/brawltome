import { getLegendById } from '@brawltome/shared'
import type { RankingRepo } from '../ranking.repo'

function sanitizeQuery(query: string): string {
  return query
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/[%\\]/g, '')
    .trim()
}

export async function searchLocal(repo: RankingRepo, rawQuery: string) {
  const query = sanitizeQuery(rawQuery)
  if (query.length < 2) return { players: [], clans: [] }

  const blacklistSet = await repo.getBlacklistedIds()

  const playersByName = await repo.searchPlayersByName(query, blacklistSet)

  const aliasMatches = await repo.searchPlayersByAlias(query)
  const aliasIds = aliasMatches
    .map((a) => a.brawlhallaId)
    .filter((id) => !blacklistSet.has(id) && !playersByName.some((p) => p.brawlhallaId === id))

  let playersByAlias: typeof playersByName = []
  if (aliasIds.length > 0) {
    playersByAlias = await repo.getPlayersByIds(aliasIds)
  }

  const players = [...playersByName, ...playersByAlias].slice(0, 40).map((p) => ({
    ...p,
    bestLegendNameKey: p.bestLegend != null ? (getLegendById(p.bestLegend)?.legendNameKey ?? null) : null,
  }))

  const clans = await repo.searchClans(query)

  return { players, clans }
}
