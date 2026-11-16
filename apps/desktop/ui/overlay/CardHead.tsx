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

// the rank banner hangs down the left of the card, like on the game's ranked screen; without a tier the empty
// pennant keeps the card the same width as the one that replaces it
export function BannerSlot({ tier }: { tier: string | null }) {
  const path = tierBannerPath(tier)

  return (
    <span className="banner-slot">
      {path === null ? <span className="banner-empty" /> : <img className="banner" src={path} alt="" />}
    </span>
  )
}

type CardHeadProps = { name: string; legend: string | null; sub: ReactNode }

export function CardHead({ name, legend, sub }: CardHeadProps) {
  return (
    <span className="head">
      <LegendPortrait legend={legend} />
      <span className="who">
        <span className="name">{name}</span>
        <span className="sub">{sub}</span>
      </span>
    </span>
  )
}
