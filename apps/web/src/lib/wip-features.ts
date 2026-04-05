import {
  BookBookmark,
  Cup,
  Feed,
  Gamepad,
  type IconProps,
  PieChart,
  User,
} from "@solar-icons/react";
import type { ComponentType } from "react";

export interface WipFeature {
  title: string;
  tagline: string;
  description: string;
  icon: ComponentType<IconProps>;
}

/**
 * Metadata for every unreleased feature that currently renders a Work-in-Progress
 * placeholder page. Keyed by URL slug. Adding a new WIP feature is three steps:
 * add an entry here, add a `navItems` entry in `sidebar/nav-items.ts`, and
 * create a page stub at `apps/web/src/app/<slug>/page.tsx`.
 */
export const wipFeatures = {
  stats: {
    title: "Statistics",
    tagline:
      "Explore legend, weapon, and meta performance across the entire Brawlhalla community.",
    description:
      "Compare win rates, pick rates, and tier placements for every legend and weapon combination. See what's strong, what's flexing, and how the meta shifts season over season.",
    icon: PieChart,
  },
  account: {
    title: "Account",
    tagline:
      "Link your Brawlhalla profile and personalize your BrawlTome experience.",
    description:
      "Sign in to save favorite players and clans, track your own progress with personalized dashboards, and sync preferences across devices.",
    icon: User,
  },
  matches: {
    title: "Matches",
    tagline: "Upload replays and browse your ranked match history.",
    description:
      "See every ranked match you've played with full context: opponent, map, legends used, and outcome. Upload replays to automatically populate stats and share with friends.",
    icon: Gamepad,
  },
  learn: {
    title: "Learn",
    tagline: "Guides, tutorials, and combo breakdowns from the BrawlTome community.",
    description:
      "Structured learning paths for every skill level. Read matchup guides, watch video tutorials, and practice combos with interactive trainers built by top players.",
    icon: BookBookmark,
  },
  tournaments: {
    title: "Tournaments",
    tagline:
      "Track brackets, results, and upcoming events from the BrawlTome scene.",
    description:
      "A central hub for Brawlhalla tournaments. Follow bracket progressions live, review historical results, and discover upcoming competitive events across skill levels.",
    icon: Cup,
  },
  feed: {
    title: "Feed",
    tagline:
      "Follow players and clans to see their activity and achievements as it happens.",
    description:
      "A social feed of updates from the players and clans you care about. Celebrate rank-ups, tournament wins, and legendary moments in one place.",
    icon: Feed,
  },
} as const satisfies Record<string, WipFeature>;
