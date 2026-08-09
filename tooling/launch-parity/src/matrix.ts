import type { ParityArea, ParityRow } from './schema'

function implemented(
  id: string,
  area: ParityArea,
  requirement: string,
  destinations: string[],
  implementation: string[],
  verificationGap: string,
): ParityRow {
  return {
    id,
    area,
    requirement,
    sourceIssue: '#188',
    status: 'implemented',
    destinations,
    implementation,
    evidence: [],
    verificationGap,
  }
}

export const launchParityMatrix: readonly ParityRow[] = [
  implemented(
    'shell.desktop-rail',
    'shell-navigation',
    'Desktop exposes the narrow branded navigation rail.',
    [],
    ['apps/web/src/components/sidebar/AppSidebar.tsx', 'apps/web/src/components/sidebar/SidebarLayout.tsx'],
    'Needs a browser assertion at the desktop breakpoint.',
  ),
  implemented(
    'shell.mobile-menu',
    'shell-navigation',
    'Mobile exposes one compact menu with the same destinations.',
    [],
    [
      'apps/web/src/components/sidebar/MobileMenu.tsx',
      'apps/web/src/components/sidebar/MobileMenuButton.tsx',
      'apps/web/src/components/sidebar/SidebarLayout.tsx',
    ],
    'Needs browser assertions for viewport visibility, focus, and route-close behavior.',
  ),
  implemented(
    'shell.home-public-search',
    'shell-navigation',
    'Home is public, unpersonalized, and search-focused.',
    ['/'],
    ['apps/web/src/app/page.tsx', 'apps/web/src/components/SearchBar.tsx'],
    'Needs a signed-out browser assertion with deterministic API data.',
  ),
  implemented(
    'shell.home-leaderboard-discovery',
    'shell-navigation',
    'Home preserves the existing leaderboard discovery destination.',
    ['/'],
    ['apps/web/src/app/page.tsx', 'apps/web/src/components/Leaderboard/index.tsx'],
    'Needs a signed-out browser assertion with deterministic leaderboard data.',
  ),
  ...[
    ['matches', 'Matches'],
    ['learn', 'Learn'],
    ['tournaments', 'Tournaments'],
    ['feed', 'Feed'],
  ].map(([slug, label]) =>
    implemented(
      `placeholder.${slug}`,
      'placeholder',
      `${label} remains a visible, non-functional Soon destination.`,
      [`/${slug}`],
      [
        `apps/web/src/app/${slug}/page.tsx`,
        'apps/web/src/components/WorkInProgress.tsx',
        'apps/web/src/components/sidebar/navigation.json',
      ],
      'Needs a rendered-page assertion that no product action is exposed.',
    ),
  ),
  ...[
    ['home', '/', 'apps/web/src/app/page.tsx'],
    ['player-id', '/player/:id', 'apps/web/src/app/player/[id]/page.tsx'],
    ['clan-id', '/clan/:id', 'apps/web/src/app/clan/[id]/page.tsx'],
    ['account', '/account', 'apps/web/src/app/account/page.tsx'],
    ['stats', '/stats', 'apps/web/src/app/stats/page.tsx'],
  ].map(([id, destination, implementation]) =>
    implemented(
      `route.${id}`,
      'preserved-public-route',
      `${destination} remains available at its established public URL.`,
      [destination],
      [implementation],
      'Needs deterministic route-level browser evidence before parity can be verified.',
    ),
  ),
]
