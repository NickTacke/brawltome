import type { FailureReason } from './overlay-view'

const REFERENCE_HEIGHT_PX = 1080
// the cards are drawn at 392 px wide; on a real screen three quarters of that is enough
const CARD_SIZE = 0.75

const countFormat = new Intl.NumberFormat('en-US')

const failureTexts: Record<FailureReason, string> = {
  offline: 'No connection',
  rateLimited: 'Too many lookups',
  unavailable: 'BrawlTome is down',
  updateRequired: 'Update BrawlTome',
  rejected: "Couldn't load",
}

export function winRatePercent(wins: number, games: number): number | null {
  if (games === 0) return null

  return Math.round((wins / games) * 100)
}

// the same thresholds as the site's player page
export function winRateClass(percent: number): 'rate-high' | 'rate-mid' | 'rate-low' {
  if (percent >= 60) return 'rate-high'

  return percent >= 50 ? 'rate-mid' : 'rate-low'
}

export function formatCount(value: number): string {
  return countFormat.format(value)
}

// the game reports a player with no ranked games as the tier "none"
export function tierLabel(tier: string): string {
  return tier === 'none' ? 'Unranked' : tier
}

// the site's rankBanner rule: Diamond and Valhallan have one banner, the other tiers one per subdivision
export function tierBannerPath(tier: string | null): string | null {
  if (tier === null) return null

  if (tier === 'none') return '/banners/Unranked.png'

  const [base, subdivision] = tier.split(' ')

  if (base === 'Diamond' || base === 'Valhallan' || subdivision === undefined) return `/banners/${base}.png`

  return `/banners/${base}%20${subdivision}.png`
}

export function legendPortraitPath(legend: string | null): string | null {
  if (legend === null) return null

  return `/legends/${legendFileName(legend)}.png`
}

// the game writes names like BÖDVAR; the art files are plain lowercase, like bodvar
function legendFileName(legend: string): string {
  const withoutAccents = legend.normalize('NFD').replace(/\p{Mark}/gu, '')

  return withoutAccents.toLowerCase()
}

// a peak below the current elo means the server has none yet, as for a player new to the season
export function shownPeak(rating: number, peakRating: number): number {
  return Math.max(rating, peakRating)
}

export function failureText(reason: FailureReason): string {
  return failureTexts[reason]
}

// css pixels already include the display scaling, so it is taken back out to size by the monitor alone
export function cardScale(monitorHeightPx: number, devicePixelRatio: number): number {
  return (monitorHeightPx / REFERENCE_HEIGHT_PX / devicePixelRatio) * CARD_SIZE
}
