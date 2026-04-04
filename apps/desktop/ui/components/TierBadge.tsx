const TIER_STYLES: Record<string, { gradient: string; text: string }> = {
  Diamond: {
    gradient: 'from-[hsla(270,50%,38%,0.9)] to-[hsla(280,40%,28%,0.9)]',
    text: 'text-[hsl(270,80%,85%)]',
  },
  Platinum: {
    gradient: 'from-[hsla(175,50%,35%,0.9)] to-[hsla(185,40%,25%,0.9)]',
    text: 'text-[hsl(175,80%,85%)]',
  },
  Gold: {
    gradient: 'from-[hsla(43,70%,40%,0.9)] to-[hsla(35,60%,30%,0.9)]',
    text: 'text-[hsl(43,90%,85%)]',
  },
  Silver: {
    gradient: 'from-[hsla(220,15%,50%,0.9)] to-[hsla(220,15%,38%,0.9)]',
    text: 'text-[hsl(220,20%,85%)]',
  },
  Bronze: {
    gradient: 'from-[hsla(25,50%,38%,0.9)] to-[hsla(20,40%,28%,0.9)]',
    text: 'text-[hsl(25,70%,85%)]',
  },
  Tin: {
    gradient: 'from-[hsla(220,10%,35%,0.9)] to-[hsla(220,10%,25%,0.9)]',
    text: 'text-[hsl(220,10%,75%)]',
  },
  Valhallan: {
    gradient: 'from-[hsla(40,80%,50%,0.9)] to-[hsla(15,70%,40%,0.9)]',
    text: 'text-[hsl(40,90%,90%)]',
  },
  Unranked: {
    gradient: 'from-[hsla(220,10%,30%,0.9)] to-[hsla(220,10%,22%,0.9)]',
    text: 'text-[hsl(220,10%,65%)]',
  },
}

function getStyle(tier: string) {
  // Tier strings may include rank number e.g. "Diamond 1", so match on prefix
  const base = Object.keys(TIER_STYLES).find((key) => tier.startsWith(key))
  return TIER_STYLES[base ?? 'Unranked']
}

interface TierBadgeProps {
  tier: string
}

export function TierBadge({ tier }: TierBadgeProps) {
  const style = getStyle(tier)

  return (
    <span
      className={`bg-gradient-to-br ${style.gradient} ${style.text} rounded px-1.5 py-px text-[9px] font-semibold`}
    >
      {tier}
    </span>
  )
}
