export interface SteamPlayerEvidence {
  brawlhallaId: number
  name: string
  checkedAt: Date
  source: 'brawlhalla-v0-steam-search'
}

export interface SteamPlayerEvidenceResolver {
  resolve(steamId: string): Promise<SteamPlayerEvidence | null>
}

export interface SteamPlayerSearchSource {
  searchBySteamId(steamId: string, options: { caller: 'background' }): Promise<unknown>
}

export function createSteamPlayerEvidenceResolver(
  source: SteamPlayerSearchSource,
  now: () => Date = () => new Date(),
): SteamPlayerEvidenceResolver {
  return {
    async resolve(steamId) {
      const result = await source.searchBySteamId(steamId, { caller: 'background' })
      if (result === null) return null
      if (!isCanonicalSearchResult(result)) throw new Error('Malformed Steam player evidence')
      return {
        brawlhallaId: result.brawlhalla_id,
        name: result.name,
        checkedAt: now(),
        source: 'brawlhalla-v0-steam-search',
      }
    },
  }
}

function isCanonicalSearchResult(value: unknown): value is { brawlhalla_id: number; name: string } {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return (
    Number.isSafeInteger(result.brawlhalla_id) &&
    (result.brawlhalla_id as number) > 0 &&
    typeof result.name === 'string' &&
    result.name.trim().length > 0
  )
}
