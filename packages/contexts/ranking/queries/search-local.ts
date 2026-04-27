import type { ClanRepo } from '@brawltome/clan'
import type { PlayerRepo } from '@brawltome/player'
import type { RankingRepo } from '../ranking.repo'

function sanitizeQuery(query: string): string {
  return query
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/[%\\_]/g, '')
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
  const aliasByPlayerId = new Map<number, string>()
  for (const m of aliasMatches) {
    if (!aliasByPlayerId.has(m.brawlhallaId)) aliasByPlayerId.set(m.brawlhallaId, m.alias)
  }
  const aliasIds = [...aliasByPlayerId.keys()].filter(
    (id) => !blacklistSet.has(id) && !playersByName.some((p) => p.brawlhallaId === id),
  )

  let playersByAlias: typeof playersByName = []
  if (aliasIds.length > 0) {
    playersByAlias = await deps.playerRepo.getPlayersByIds(aliasIds)
  }

  const merged = [...playersByName, ...playersByAlias].slice(0, 40)
  const effective = await deps.playerRepo.getEffectiveBestLegendsBatch(merged.map((p) => p.brawlhallaId))

  const players = merged.map((p) => ({
    ...p,
    bestLegendNameKey: effective.get(p.brawlhallaId)?.legendNameKey ?? null,
    matchedAlias: aliasByPlayerId.get(p.brawlhallaId) ?? null,
  }))

  const clans = await deps.clanRepo.searchClans(query)

  return { players, clans }
}
