'use client'

// biome-ignore lint/suspicious/noExplicitAny: dynamic API response
export type PlayerData = any

export const getRankBanner = (tier?: string | null) => {
  if (!tier) return '/images/banners/Unranked.png'
  const parts = tier.split(' ')
  const baseTier = parts[0]
  const subdivision = parts[1]
  if (baseTier === 'Diamond') return '/images/banners/Diamond.png'
  if (baseTier === 'Valhallan') return '/images/banners/Valhallan.png'
  const tiersWithSubs = ['Tin', 'Bronze', 'Silver', 'Gold', 'Platinum']
  if (tiersWithSubs.includes(baseTier) && subdivision !== undefined)
    return `/images/banners/${baseTier}%20${subdivision}.png`
  if (tiersWithSubs.includes(baseTier)) return `/images/banners/${baseTier}.png`
  return '/images/banners/Unranked.png'
}

export const getWeaponIcon = (weapon: string) => `/images/weapons/${weapon}.png`

export const getGloryFromWins = (wins: number): number => {
  if (wins <= 150) return 20 * wins
  return Math.floor(10 * (45 * Math.log10(wins * 2) ** 2) + 245)
}

export const getGloryFromBestRating = (bestRating: number): number => {
  if (bestRating < 1200) return 250
  if (bestRating < 1286) return Math.floor(10 * (25 + 0.872093023 * (86 - (1286 - bestRating))))
  if (bestRating < 1390) return Math.floor(10 * (100 + 0.721153846 * (104 - (1390 - bestRating))))
  if (bestRating < 1680) return Math.floor(10 * (187 + 0.389655172 * (290 - (1680 - bestRating))))
  if (bestRating < 2000) return Math.floor(10 * (300 + 0.428125 * (320 - (2000 - bestRating))))
  if (bestRating < 2300) return Math.floor(10 * (437 + 0.143333333 * (300 - (2300 - bestRating))))
  return Math.floor(10 * (480 + 0.05 * (400 - (2700 - bestRating))))
}

export const calculateGlory = (wins: number, peakRating: number) =>
  getGloryFromWins(wins) + getGloryFromBestRating(peakRating)

export const calculateEloReset = (rating: number) =>
  rating < 1400 ? rating : Math.floor(1400 + (rating - 1400) / (3 - (3000 - rating) / 800))

export const formatHours = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0))
  const hoursRaw = seconds / 3600
  const hoursRounded = Math.round(hoursRaw * 10) / 10
  return Number.isInteger(hoursRounded) ? `${hoursRounded}h` : `${hoursRounded.toFixed(1)}h`
}

export const formatCompact = (n: number | bigint): string => {
  const num = typeof n === 'bigint' ? Number(n) : n
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
  if (num >= 100_000) return `${(num / 1_000).toFixed(0)}K`
  if (num >= 10_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toLocaleString()
}

export const parseNum = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? '0'), 10)
  return Number.isFinite(n) ? n : 0
}

export const getVirtualLevel = (xp: number) => {
  const a = 127.62
  const b = -2164.2
  const c = 14553 - xp
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return 0
  return (-b + Math.sqrt(discriminant)) / (2 * a)
}

export const getXpForLevel = (lv: number) => {
  return 127.62 * lv ** 2 - 2164.2 * lv + 14553
}

export const WinLossBar = ({ percent, className }: { percent: number; className?: string }) => {
  const clamped = Math.max(0, Math.min(100, percent || 0))
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-danger-muted ${className || ''}`}
      role="progressbar"
      tabIndex={0}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Win rate ${clamped.toFixed(1)}%`}
    >
      <div className="h-full bg-success transition-all" style={{ width: `${clamped}%` }} />
    </div>
  )
}
