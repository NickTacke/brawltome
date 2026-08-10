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
    id: 'account.primary-player-verification',
    area: 'account-authentication',
    requirement:
      'Authenticated Steam proof creates auditable attempts; only conflict-free canonical Players evidence establishes one Primary Player.',
    sourceIssue: '#204',
    status: 'verified',
    destinations: ['/account', '/auth/steam/link', '/auth/steam/callback'],
    implementation: [
      'packages/contexts/accounts/src/accounts.ts',
      'packages/contexts/accounts/src/postgres-store.ts',
      'packages/contexts/accounts/migrations/0004-add-primary-player-verification.ts',
      'packages/contexts/player/verification.ts',
      'apps/api/src/auth/routes.ts',
      'apps/api/src/router/account.router.ts',
      'apps/web/src/app/account/BrawlhallaLinkRow.tsx',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/primary-player.postgres.test.ts',
        assertion: 'Real PostgreSQL races preserve every attempt and allow at most one owner per account and player.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/identity/auth-routes.test.ts',
        assertion: 'Authenticated Steam verification bypasses Turnstile while retaining account and IP admission.',
      },
      {
        kind: 'unit',
        path: 'packages/contracts/tests/account.test.ts',
        assertion: 'Canonical ownership history rejects private Steam proof subjects and impossible attempt states.',
      },
    ],
  },
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
    id: 'desktop.ranked-opponent-lookup',
    area: 'player-profile',
    requirement:
      'Desktop opponent lookup uses the generated canonical Ranked Player Snapshot client, ranked-only admission, bounded polling, and truthful degraded presentation.',
    sourceIssue: '#216',
    status: 'verified',
    destinations: ['/api/overlay/opponent/:brawlhallaId', 'https://brawltome.com/player/:id'],
    implementation: [
      'packages/contracts/src/desktop-ranked.ts',
      'apps/api/src/routes/desktop-ranked.routes.ts',
      'apps/desktop/app/src/api_client.rs',
      'apps/desktop/app/src/detection_bridge.rs',
      'apps/desktop/ui/components/OpponentCard.tsx',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contracts/tests/desktop-ranked.test.ts',
        assertion: 'Shared fixtures preserve nullable, UTC, measured-zero, stale, blocked, and refreshing semantics.',
      },
      {
        kind: 'integration',
        path: 'apps/api/tests/desktop-ranked.routes.test.ts',
        assertion:
          'The preserved route deduplicates and admits ranked-only work while retaining missing or stale cache.',
      },
      {
        kind: 'external',
        path: 'apps/desktop/app/tests/api_client.rs',
        assertion:
          'The generated Rust operation rejects malformed/API failures and maps every canonical state without invented values.',
      },
      {
        kind: 'unit',
        path: 'apps/desktop/tests/opponent-status.test.ts',
        assertion:
          'Desktop user language distinguishes updated, refreshing, delayed, verification, and unavailable states.',
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
  {
    id: 'player.career-statistics',
    area: 'player-profile',
    requirement:
      'The preserved player URL publishes Players-owned complete V0 lifetime Career Statistics independently from Current Season with twelve-hour freshness.',
    sourceIssue: '#195',
    status: 'verified',
    destinations: ['/player/:id'],
    implementation: [
      'packages/contexts/player/career/source.ts',
      'packages/contexts/player/career/postgres.ts',
      'packages/contracts/src/player-career.ts',
      'apps/api/src/router/player-career.router.ts',
      'apps/web/src/components/player/CareerStatistics.tsx',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contexts/player/tests/career-source.test.ts',
        assertion:
          'Strict V0 decoding preserves exact damage, measured zero, authoritative empties, and rejects unresolved legends.',
      },
      {
        kind: 'external',
        path: 'apps/api/tests/player-career.postgres.test.ts',
        assertion:
          'Real PostgreSQL proves atomic checkpoints, retention, authoritative replacement, lease fencing, and crash reconciliation.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/player-career.router.test.ts',
        assertion: 'The canonical career API maps Players state and rejects malformed producer output.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/player/CareerStatistics.test.tsx',
        assertion:
          'Rendered lifetime UI labels supported facts, omits unavailable deep sections, and makes no weapon performance claim.',
      },
    ],
  },
  {
    id: 'player.canonical-profile',
    area: 'player-profile',
    requirement:
      'Every viewer receives one preserved-URL identity, Competitive Snapshot, Current Season, then Career hierarchy with independent source evidence, honest missing states, and coverage-qualified observed direction.',
    sourceIssue: '#197',
    status: 'verified',
    destinations: ['/player/:id'],
    implementation: [
      'packages/contexts/player/ranked/model.ts',
      'packages/contexts/player/ranked/postgres.ts',
      'packages/contracts/src/player-ranked.ts',
      'apps/api/src/mappers/player-ranked.mapper.ts',
      'apps/web/src/lib/player-reference.ts',
      'apps/web/src/components/player/PlayerProfile/PlayerProfileHierarchy.tsx',
      'apps/web/src/components/player/RankedCard.tsx',
      'apps/web/src/components/player/PlayerProfile/ProfileSections.tsx',
      'apps/web/src/components/player/RatingChart/index.tsx',
      'apps/web/src/components/player/CareerStatistics.tsx',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contexts/player/tests/ranked-model.test.ts',
        assertion:
          'Observed direction uses only the latest monotonic-games segment of Players-owned complete-ranked observations.',
      },
      {
        kind: 'unit',
        path: 'packages/contracts/tests/player-ranked.test.ts',
        assertion:
          'The canonical contract separates complete-ranked and sparse-pulse timestamps and bounds direction to published history coverage.',
      },
      {
        kind: 'external',
        path: 'apps/api/tests/player-ranked.postgres.test.ts',
        assertion:
          'Dedicated real PostgreSQL proves V0-only history direction, independently checked sparse pulses, measured zero, and non-destructive failure.',
      },
      {
        kind: 'integration',
        path: 'apps/web/tests/lib/player-reference.test.ts',
        assertion: 'Canonical Players identity renders at the preserved URL without requiring optional V2 enrichment.',
      },
      {
        kind: 'integration',
        path: 'apps/web/tests/components/player/PlayerProfileHierarchy.test.tsx',
        assertion:
          'Rendered output keeps one viewer-neutral identity, Competitive Snapshot, Current Season, then Career hierarchy.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/player/RankedCard.test.tsx',
        assertion:
          'Competitive facts distinguish measured zero from unavailable ratios and qualify direction and pulse coverage without advice or causality.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/player/ProfileSections.test.tsx',
        assertion:
          'Unsupported deep sections explain and collapse while supported detail uses native disclosure semantics.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/player/RatingChart.test.tsx',
        assertion:
          'Rating history exposes a screen-reader observation list, coverage description, and pressed-state filters.',
      },
    ],
  },
  {
    id: 'statistics.eu-diamond-cohort-tracer',
    area: 'global-statistics',
    requirement:
      'Global Statistics deterministically selects and durably collects exactly the EU Diamond+ launch cohort cell from one immutable Ranking generation.',
    sourceIssue: '#209',
    status: 'verified',
    destinations: ['operations-worker'],
    implementation: [
      'packages/contexts/statistics/cohort.ts',
      'packages/contexts/statistics/postgres.ts',
      'packages/contexts/statistics/source.ts',
      'apps/api/src/statistics-cohort-reconciliation.ts',
      'apps/api/src/statistics-collection-source.ts',
      'apps/api/src/refresh-operations-worker.ts',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contexts/statistics/tests/cohort.test.ts',
        assertion:
          'Known SHA-256 answers prove rating-derived deterministic selection, version salting, the 750 cap, and the 125-player evidence boundary.',
      },
      {
        kind: 'integration',
        path: 'apps/api/tests/statistics-cohort.postgres.test.ts',
        assertion:
          'Real PostgreSQL proves immutable-generation restart, concurrent reconciliation, independent bounded operations, active fences, and post-effect crash recovery.',
      },
      {
        kind: 'integration',
        path: 'apps/api/tests/statistics-worker.postgres.test.ts',
        assertion:
          'The production worker admits each ranked/lifetime V1 attempt independently across restart and never calls team or guild endpoints.',
      },
    ],
  },
]
