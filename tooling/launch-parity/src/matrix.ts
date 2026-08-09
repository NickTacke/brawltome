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
    { id: 'home', destination: '/', implementation: ['apps/web/src/app/page.tsx'] },
    {
      id: 'player-id',
      destination: '/player/:id',
      implementation: [
        'packages/contracts/src/player-reference.ts',
        'packages/contexts/player/reference.ts',
        'apps/api/src/router/player-reference.router.ts',
        'apps/web/src/lib/player-reference.ts',
        'apps/web/src/app/player/[id]/page.tsx',
      ],
    },
    { id: 'clan-id', destination: '/clan/:id', implementation: ['apps/web/src/app/clan/[id]/page.tsx'] },
    { id: 'account', destination: '/account', implementation: ['apps/web/src/app/account/page.tsx'] },
    { id: 'stats', destination: '/stats', implementation: ['apps/web/src/app/stats/page.tsx'] },
  ].map(({ id, destination, implementation }) =>
    implemented(
      `route.${id}`,
      'preserved-public-route',
      `${destination} remains available at its established public URL.`,
      [destination],
      implementation,
      'Needs deterministic route-level browser evidence before parity can be verified.',
    ),
  ),
  {
    id: 'refresh.interactive-player',
    area: 'refresh-admission',
    requirement:
      'Interactive player refreshes preserve cache, deduplicate before PostgreSQL actor/source admission, and return canonical outcomes.',
    sourceIssue: '#191',
    status: 'verified',
    destinations: ['/player/:id'],
    implementation: [
      'packages/contracts/src/refresh-outcome.ts',
      'packages/contexts/request-admission/postgres.ts',
      'packages/contexts/refresh-operations/postgres.ts',
      'apps/api/src/router/player.router.ts',
      'apps/api/src/auth/refresh-trust-cookie.ts',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contracts/tests/refresh-outcome.test.ts',
        assertion: 'All six canonical outcomes and retry guidance validate.',
      },
      {
        kind: 'external',
        path: 'apps/api/tests/request-admission.postgres.test.ts',
        assertion: 'Real PostgreSQL concurrency preserves dedup and quota invariants.',
      },
      {
        kind: 'external',
        path: 'apps/api/tests/player-refresh.router.test.ts',
        assertion: 'Cached data, authenticated bypass, semantic outcomes, and V2 compatibility hold.',
      },
    ],
  },
]
