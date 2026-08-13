import { BookBookmark, Cup, Gamepad, type IconProps, PieChart, UsersGroupRounded } from '@solar-icons/react'
import type { ComponentType } from 'react'

export interface WipFeature {
  title: string
  tagline: string
  description: string
  icon: ComponentType<IconProps>
}

/**
 * Metadata for every unreleased feature that currently renders a Work-in-Progress
 * placeholder page. Keyed by URL slug. Adding a new WIP feature is three steps:
 * add an entry here, add a `navItems` entry in `sidebar/nav-items.ts`, and
 * create a page stub at `apps/web/src/app/<slug>/page.tsx`.
 */
export const wipFeatures = {
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
  feed: {
    title: 'Feed',
    tagline: 'Activity and posts from players you follow',
    description:
      "Rank changes, tournament runs, notable matches from followed players and clans. Plus their posts. Nothing you didn't ask to see",
    icon: UsersGroupRounded,
  },
} as const satisfies Record<string, WipFeature>
