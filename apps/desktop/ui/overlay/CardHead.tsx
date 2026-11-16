import { type ReactNode, useState } from 'react'
import { legendPortraitPath, tierBannerPath } from './card-format'

type LegendPortraitProps = { legend: string | null; isSmall?: boolean }

// a legend the app has no art for, or art that fails to load, shows the ? portrait instead
export function LegendPortrait({ legend, isSmall = false }: LegendPortraitProps) {
  const [hasFailed, setHasFailed] = useState(false)
  const path = legendPortraitPath(legend)
  const sizeClass = isSmall ? ' small' : ''

  if (path === null || hasFailed) return <span className={`portrait unknown${sizeClass}`}>?</span>

  return <img className={`portrait${sizeClass}`} src={path} alt="" onError={() => setHasFailed(true)} />
}

export function TierBanner({ tier }: { tier: string | null }) {
  const path = tierBannerPath(tier)

  if (path === null) return null

  return <img className="banner" src={path} alt="" />
}

type CardHeadProps = { name: string; legend: string | null; sub: ReactNode; tier: string | null }

export function CardHead({ name, legend, sub, tier }: CardHeadProps) {
  return (
    <span className="head">
      <LegendPortrait legend={legend} />
      <span className="who">
        <span className="name">{name}</span>
        <span className="sub">{sub}</span>
      </span>
      <TierBanner tier={tier} />
    </span>
  )
}
