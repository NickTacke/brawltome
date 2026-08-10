import type { ParityArea, ParityRow } from './schema'

function verifiedAccount(
  id: string,
  requirement: string,
  destinations: string[],
  implementation: string[],
  evidence: ParityRow['evidence'],
): ParityRow {
  return {
    id,
    area: 'account-authentication',
    requirement,
    sourceIssue: '#203',
    status: 'verified',
    destinations,
    implementation,
    evidence,
  }
}

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
  verifiedAccount(
    'account.canonical-view',
    'Anonymous and signed-in web account identity uses the canonical Accounts contract.',
    ['/account'],
    ['packages/contracts/src/account.ts', 'apps/api/src/router/account.router.ts', 'apps/web/src/lib/auth.ts'],
    [
      {
        kind: 'unit',
        path: 'packages/contracts/tests/account.test.ts',
        assertion: 'Strict anonymous and signed-in account contracts reject persistence details.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/lib/auth.test.ts',
        assertion: 'Web parses the canonical account response rather than an inferred identity shape.',
      },
    ],
  ),
  verifiedAccount(
    'account.sign-in-sign-out',
    'Discord sign-in and origin-protected sign-out pass through Accounts while preserving session cookies.',
    ['/auth/discord/login', '/auth/discord/callback', '/auth/signout'],
    ['packages/contexts/accounts/src/accounts.ts', 'apps/api/src/auth/routes.ts'],
    [
      {
        kind: 'unit',
        path: 'apps/api/tests/identity/auth-routes.test.ts',
        assertion: 'OAuth callback and sign-out delegate through Accounts and preserve cookie behavior.',
      },
    ],
  ),
  {
    id: 'account.v2-session-migration',
    area: 'account-authentication',
    requirement: 'Valid V2 OAuth identities and sessions retain their identifiers and authenticate after migration.',
    sourceIssue: '#203',
    status: 'implemented',
    destinations: [],
    implementation: [
      'packages/contexts/accounts/migrations/0001-initialize-and-import-v2.ts',
      'packages/contexts/accounts/migrations/0002-add-v2-auth-cutover-state.ts',
      'packages/contexts/accounts/src/v2-compatibility.ts',
      'packages/contexts/accounts/src/finalize-v2-auth-cutover.ts',
      'tooling/database-migrations/src/inventories.ts',
      'tooling/database-migrations/src/finalize-accounts-v2-auth-cutover.ts',
    ],
    evidence: [],
    verificationGap:
      'Service-backed migration, cutover finalization, and legacy-table retirement evidence requires DATABASE_URL and runs in the PostgreSQL-enabled CI check job, not this database-less parity job.',
  },
  {
    id: 'account.launch-preferences',
    area: 'account-authentication',
    requirement:
      'Signed-in leaderboard defaults round-trip across sessions and devices while anonymous visitors receive non-persisted defaults.',
    sourceIssue: '#207',
    status: 'implemented',
    destinations: ['/', '/trpc/account.preferences', '/trpc/account.updatePreferences'],
    implementation: [
      'packages/contexts/accounts/src/accounts.ts',
      'packages/contexts/accounts/src/postgres-store.ts',
      'packages/contexts/accounts/migrations/0003-add-preferences.ts',
      'packages/contracts/src/account.ts',
      'apps/api/src/router/account.router.ts',
      'apps/web/src/components/Leaderboard/index.tsx',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contracts/tests/account.test.ts',
        assertion: 'The strict versioned contract accepts only launch-consumed leaderboard bracket and region fields.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/account.router.test.ts',
        assertion:
          'Anonymous defaults, protected updates, strict input validation, and producer output validation pass.',
      },
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/accounts.postgres.test.ts',
        assertion:
          'Real PostgreSQL proves migration ownership and authenticated cross-session, cross-runtime round-trip.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/Leaderboard/utils.test.ts',
        assertion:
          'Home consumes canonical defaults, preserves URL precedence, and persists only authenticated filters.',
      },
    ],
    verificationGap:
      'Needs a browser assertion for authenticated selector persistence, account transitions, rapid updates, and visible save failure behavior.',
  },
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
  {
    id: 'ranking.immutable-1v1-publication',
    area: 'shell-navigation',
    requirement: 'Home reads one immutable validated 1v1 generation and retains the last valid generation as stale.',
    sourceIssue: '#201',
    status: 'verified',
    destinations: ['/'],
    implementation: [
      'packages/contexts/ranking/leaderboard.ts',
      'packages/contexts/ranking/postgres.ts',
      'apps/api/src/router/leaderboard.router.ts',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'apps/api/tests/ranking-snapshots.postgres.test.ts',
        assertion:
          'PostgreSQL proves atomic publication, lease fencing, restart, immutability, Global parity, and stale retention.',
      },
    ],
  },
  {
    id: 'ranking.immutable-all-mode-publication',
    area: 'shell-navigation',
    requirement:
      'Home serves immutable validated fixed 2v2, Solo 2v2, and 3v3 standings with independent stale retention and snapshot-pinned pagination.',
    sourceIssue: '#202',
    status: 'verified',
    destinations: ['/'],
    implementation: [
      'packages/contexts/ranking/leaderboard.ts',
      'packages/contexts/ranking/postgres.ts',
      'packages/contracts/src/leaderboard.ts',
      'apps/api/src/router/leaderboard.router.ts',
      'apps/web/src/components/Leaderboard/index.tsx',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'apps/api/tests/ranking-snapshots.postgres.test.ts',
        assertion:
          'PostgreSQL proves all-mode migration, identity constraints, atomic fencing, independent stale retention, restart, and snapshot-pinned pagination.',
      },
      {
        kind: 'unit',
        path: 'packages/contexts/ranking/tests/v1-leaderboard-source.test.ts',
        assertion:
          'Strict source probes reject zero IDs, cardinality drift, malformed metrics, and mode identity mixing.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/Leaderboard/LeaderboardRow.test.tsx',
        assertion: 'Home rows preserve authoritative source rank and never construct a player-zero link.',
      },
    ],
  },
  {
    id: 'ranking.home-snapshot-states',
    area: 'shell-navigation',
    requirement:
      'Home distinguishes validated fresh, retained stale, first-publication unavailable, and transport failure states.',
    sourceIssue: '#201',
    status: 'implemented',
    destinations: ['/'],
    implementation: ['apps/web/src/components/Leaderboard/index.tsx', 'apps/web/src/components/Leaderboard/utils.ts'],
    evidence: [],
    verificationGap:
      'Needs a rendered browser assertion covering fresh-to-stale, scope changes, first-publication unavailable, and transport failure.',
  },
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
    id: 'operations.dead-letters',
    area: 'operator-operations',
    requirement:
      'Authenticated operators can list, inspect, replay, or discard dead letters through an audited JSON CLI.',
    sourceIssue: '#193',
    status: 'verified',
    destinations: [],
    implementation: [
      'packages/contexts/refresh-operations/cli.ts',
      'packages/contexts/refresh-operations/operator-auth.ts',
      'packages/contexts/refresh-operations/postgres.ts',
      'packages/contexts/refresh-operations/migrations/0008-add-dead-letter-operations.ts',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'packages/contexts/refresh-operations/tests/dead-letters.postgres.test.ts',
        assertion:
          'Real PostgreSQL and spawned CLI tests prove authentication, redaction, lineage, concurrency, idempotency, and immutable audit behavior.',
      },
      {
        kind: 'unit',
        path: 'tooling/architecture/tests/architecture.test.ts',
        assertion: 'The operator CLI remains capability-owned behind approved package boundaries.',
      },
    ],
  },
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
  {
    id: 'player.current-season-ranked',
    area: 'player-profile',
    requirement:
      'The preserved player URL publishes Players-owned complete V0 Current Season state with independent freshness and non-destructive failure semantics.',
    sourceIssue: '#194',
    status: 'verified',
    destinations: ['/player/:id'],
    implementation: [
      'packages/contexts/player/ranked/source.ts',
      'packages/contexts/player/ranked/postgres.ts',
      'packages/contracts/src/player-ranked.ts',
      'apps/api/src/router/player-ranked.router.ts',
      'apps/web/src/components/player/PlayerProfile/ProfileSections.tsx',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contexts/player/tests/ranked-source.test.ts',
        assertion: 'Complete V0 snapshots preserve measured zero and separate fixed teams from ordered Solo Queue.',
      },
      {
        kind: 'external',
        path: 'apps/api/tests/player-ranked.postgres.test.ts',
        assertion:
          'Real PostgreSQL proves fenced effects, last-success preservation, authoritative empties, and history.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/player-ranked.router.test.ts',
        assertion: 'The canonical API maps Players state and validates producer output.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/lib/current-season.test.ts',
        assertion: 'The preserved profile uses canonical Current Season values without legacy ranked fallback.',
      },
    ],
  },
]
