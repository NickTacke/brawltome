import { BookBookmark, Cup, Gamepad, type IconProps, UsersGroupRounded } from '@solar-icons/react'
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
  matches: {
    title: 'Matches',
    tagline: 'Match history is coming later',
    description: 'This destination is reserved while the first V3 release focuses on public player and clan discovery.',
    icon: Gamepad,
  },
  learn: {
    title: 'Learn',
    tagline: 'Learning resources are coming later',
    description: 'This destination remains visible, but it is not part of the first V3 release.',
    icon: BookBookmark,
  },
  tournaments: {
    title: 'Tournaments',
    tagline: 'Tournament features are coming later',
    description: 'This destination remains visible, but tournament workflows are not part of the first V3 release.',
    icon: Cup,
  },
  feed: {
    title: 'Feed',
    tagline: 'Social activity is coming later',
    description:
      'This destination remains visible, but social posting and following are not part of the first V3 release.',
    icon: UsersGroupRounded,
  },
} as const satisfies Record<string, WipFeature>
