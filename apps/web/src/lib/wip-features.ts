import {
  BookBookmark,
  Cup,
  Gamepad,
  type IconProps,
  PieChart,
  User,
  UsersGroupRounded,
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
    tagline: "See which legends and weapons are actually winning right now",
    description:
      "Win rates, pick rates, and tier placements pulled from every ranked player we track. Refreshes as the meta shifts, no guesswork about which matchups are real",
    icon: PieChart,
  },
  account: {
    title: "Account",
    tagline: "Your own profile on BrawlTome",
    description:
      "Sign in to bookmark players you're watching, save your Brawlhalla ID for one-click lookups, and get a heads-up when friends hit new peaks",
    icon: User,
  },
  matches: {
    title: "Matches",
    tagline: "Your ranked match history, fully replayable",
    description:
      "Every ranked game in one timeline. Drop a replay file and it fills in the details for you: opponent, map, legends, outcome, damage taken",
    icon: Gamepad,
  },
  learn: {
    title: "Learn",
    tagline: "Guides and combos, written by players who actually play",
    description:
      "Matchup writeups, combo breakdowns, and tech tutorials. No chatbot filler, just real players sharing what works and why",
    icon: BookBookmark,
  },
  tournaments: {
    title: "Tournaments",
    tagline: "Every Brawlhalla tournament, live and archived",
    description:
      "Bracket view, match results, and a calendar of what's coming up. Local weeklies all the way through to Worlds",
    icon: Cup,
  },
  feed: {
    title: "Feed",
    tagline: "Updates from the players you follow",
    description:
      "Rank changes, tournament wins, and notable games from the players and clans you're tracking. Nothing you didn't ask to see",
    icon: UsersGroupRounded,
  },
} as const satisfies Record<string, WipFeature>;
