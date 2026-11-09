export function formatHours(totalSeconds: number): string {
  return `${formatGrouped(Math.round(totalSeconds / 3600))}h`
}

export function formatGrouped(value: number): string {
  return value.toLocaleString('en-GB')
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`

  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`

  return formatGrouped(value)
}

export function winPercent(wins: number, games: number): number {
  return games > 0 ? (wins / games) * 100 : 0
}

export function winRateColour(percent: number): string {
  if (percent >= 60) return 'text-emerald-400'

  return percent >= 50 ? 'text-primary' : 'text-soft'
}

export function rankBanner(tier: string | null | undefined): string {
  if (!tier || tier === 'none') return '/images/banners/Unranked.png'

  const [base, subdivision] = tier.split(' ')

  if (base === 'Diamond' || base === 'Valhallan') return `/images/banners/${base}.png`

  return subdivision === undefined ? `/images/banners/${base}.png` : `/images/banners/${base}%20${subdivision}.png`
}

export function eloReset(rating: number): number {
  return rating < 1400 ? rating : Math.floor(1400 + (rating - 1400) / (3 - (3000 - rating) / 800))
}

// matched to the banner art, so the graph and the tier names agree with the banner beside them
export const ratingBands = [
  { name: 'Diamond', rating: 2000, colour: '#a78bfa' },
  { name: 'Platinum', rating: 1680, colour: '#38bdf8' },
  { name: 'Gold', rating: 1390, colour: '#eab308' },
  { name: 'Silver', rating: 1130, colour: '#b6c2d1' },
  { name: 'Bronze', rating: 910, colour: '#d97706' },
  { name: 'Tin', rating: 0, colour: '#4f9d69' },
]

const valhallanColour = '#e9a8f5'
const unrankedColour = '#3b4252'

export function tierColour(tier: string | null | undefined): string {
  const base = tier?.split(' ')[0]

  if (base === 'Valhallan') return valhallanColour

  return ratingBands.find(({ name }) => name === base)?.colour ?? unrankedColour
}

export function virtualLevel(xp: number): { level: number; progressPercent: number } {
  const discriminant = 2164.2 ** 2 - 4 * 127.62 * (14553 - xp)
  const level = Math.floor((2164.2 + Math.sqrt(Math.max(discriminant, 0))) / (2 * 127.62))
  const xpForLevel = (target: number) => 127.62 * target ** 2 - 2164.2 * target + 14553
  const progressPercent = Math.floor(((xp - xpForLevel(level)) / (xpForLevel(level + 1) - xpForLevel(level))) * 100)

  return { level, progressPercent }
}

export function legendName(key: string): string {
  return key.replace(/^redraptor$/i, 'Red Raptor')
}

// keeps every value short enough for a legend tile, whatever the size of the number
export function formatShort(value: number): string {
  if (value >= 999_500) return `${Number((value / 1_000_000).toFixed(1))}M`

  if (value >= 100_000) return `${Math.round(value / 1000)}K`

  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}K`

  return String(value)
}

export const excludeUnarmedCookie = 'exclude_unarmed'

// stored peaks can lag behind the rating, and a peak below the rating would read as a mistake
export function bestRating(rating: number, peakRating: number): number {
  return Math.max(rating, peakRating)
}
