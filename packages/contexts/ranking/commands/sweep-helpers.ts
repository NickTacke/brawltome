// New endpoint returns 'JPS' for Japan; the rest of the codebase uses 'JPN'.
export function normalizeRegion(region: string): string {
  return region === 'JPS' ? 'JPN' : region
}

export type TierFallbackKind = 'diamond' | 'unexpected_null' | null

// Defensive rating-bucket fallback. Only fires when api tier is missing AND
// best_rating < 2000, a case we have not observed in 5,000+ sampled rows per bracket.
function ratingBucket(rating: number): string {
  if (rating >= 2000) return 'Diamond'
  if (rating >= 1700) return 'Platinum'
  if (rating >= 1400) return 'Gold'
  if (rating >= 1200) return 'Silver'
  if (rating >= 1000) return 'Bronze'
  return 'Tin'
}

export function resolveTier(input: { apiTier: string | undefined | null; bestRating: number }): {
  tier: string
  fallback: TierFallbackKind
} {
  if (input.apiTier) return { tier: input.apiTier, fallback: null }
  if (input.bestRating >= 2000) return { tier: 'Diamond', fallback: 'diamond' }
  return { tier: ratingBucket(input.bestRating), fallback: 'unexpected_null' }
}
