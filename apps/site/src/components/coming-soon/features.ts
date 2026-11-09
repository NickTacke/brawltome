import { BookBookmark, Cup, Gamepad, type IconProps, PieChart } from '@solar-icons/react'
import type { ComponentType } from 'react'

export type ComingSoonFeature = { title: string; tagline: string; description: string; icon: ComponentType<IconProps> }

// the wording is the old site's, kept as it was
export const comingSoonFeatures = {
  stats: {
    title: 'Statistics',
    tagline: 'Win rates, pick rates, tier list. Real ranked data',
    description:
      'Legends and weapons ranked by win rate, pick rate, tier. Filter by rank bracket and region. Pulled from every ranked player we track, updated as the meta shifts',
    icon: PieChart,
  },
  matches: {
    title: 'Matches',
    tagline: 'Full ranked history. Every replay, every stat',
    description:
      'Desktop overlay auto-uploads replays as you play. Per-weapon damage, dodges, movement, damage timelines, stock-by-stock. Your whole ranked career in one place',
    icon: Gamepad,
  },
  learn: {
    title: 'Learn',
    tagline: 'Guides, combos, tech. Progression paths built for you',
    description:
      'Matchup writeups, combo breakdowns, tech tutorials. Personal paths by difficulty, legend, and skill (edgeguarding, neutral, recovery)',
    icon: BookBookmark,
  },
  tournaments: {
    title: 'Tournaments',
    tagline: 'Every Brawlhalla tournament. Official, community, and yours',
    description:
      'Live brackets, results, and streams from Challengermode-hosted events. Players linked to their BrawlTome profiles. Approved organizers can host tournaments directly on BrawlTome',
    icon: Cup,
  },
} as const satisfies Record<string, ComingSoonFeature>

export type ComingSoonSlug = keyof typeof comingSoonFeatures
