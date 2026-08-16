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
    id: 'account.saved-players',
    area: 'account-authentication',
    requirement:
      'Signed-in users privately save, remove, find, and manually order Saved Players with canonical observation scope and freshness.',
    sourceIssue: '#205',
    status: 'verified',
    destinations: ['/account', '/player/[id]'],
    implementation: [
      'packages/contexts/accounts/src/accounts.ts',
      'packages/contexts/accounts/src/postgres-store.ts',
      'packages/contexts/accounts/migrations/0005-add-saved-players.ts',
      'packages/contracts/src/account.ts',
      'apps/api/src/router/account.router.ts',
      'apps/web/src/app/account/SavedPlayersSection.tsx',
      'apps/web/src/components/player/PlayerProfile/SavedPlayerButton.tsx',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/saved-players.postgres.test.ts',
        assertion:
          'Real PostgreSQL proves private account visibility, bounded idempotent save/remove, and atomic stable order under concurrency.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/account.router.test.ts',
        assertion:
          'Protected procedures derive account identity from the session and reject public identity injection and unknown players.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/account/SavedPlayersSection.test.tsx',
        assertion:
          'Saved Players UI exposes accessible controls and canonical complete-ranked, sparse-pulse, freshness, and coverage disclosures.',
      },
    ],
  },
  {
    id: 'account.pinned-player-shortcuts',
    area: 'account-authentication',
    requirement:
      'Signed-in navigation shows Primary first as You and up to four manually ordered Saved Player pins identically on desktop and mobile.',
    sourceIssue: '#206',
    status: 'verified',
    destinations: ['/account', '/player/[id]'],
    implementation: [
      'packages/contexts/accounts/migrations/0006-add-pinned-player-shortcuts.ts',
      'packages/contexts/accounts/src/accounts.ts',
      'packages/contexts/accounts/src/postgres-store.ts',
      'packages/contracts/src/account.ts',
      'apps/api/src/router/account.router.ts',
      'apps/web/src/lib/playerShortcuts.ts',
      'apps/web/src/components/sidebar/AppSidebar.tsx',
      'apps/web/src/components/sidebar/MobileMenu.tsx',
      'apps/web/src/app/account/SavedPlayersSection.tsx',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/pinned-shortcuts.postgres.test.ts',
        assertion:
          'Real PostgreSQL proves pin membership, maximum, stable order, isolation, idempotence, concurrency, cascading removal, and Primary transition semantics.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/account.router.test.ts',
        assertion:
          'Protected canonical output keeps Primary structurally first, preserves pin order, maps effective-main facts, and rejects anonymous disclosure.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/lib/player-shortcuts.test.ts',
        assertion:
          'One private navigation contract derives You, ordered pins, effective-main avatars, fallback labels, and All Saved Players for both layouts.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/account/SavedPlayersSection.test.tsx',
        assertion:
          'Account pin toggles and independent ordering controls have explicit accessible names and disabled states.',
      },
    ],
  },
  {
    id: 'account.v2-session-migration',
    area: 'account-authentication',
    requirement: 'Valid V2 OAuth identities and sessions retain their identifiers and authenticate after migration.',
    sourceIssue: '#224',
    status: 'implemented',
    destinations: [],
    implementation: [
      'packages/contexts/accounts/migrations/0001-initialize-and-import-v2.ts',
      'packages/contexts/accounts/migrations/0002-add-v2-auth-cutover-state.ts',
      'packages/contexts/accounts/migrations/0007-add-v2-accounts-import-evidence.ts',
      'packages/contexts/accounts/src/v2-compatibility.ts',
      'packages/contexts/accounts/src/finalize-v2-auth-cutover.ts',
      'packages/contexts/accounts/src/legacy-import.ts',
      'tooling/database-migrations/src/import-accounts.ts',
      'tooling/database-migrations/src/inventories.ts',
    ],
    evidence: [],
    verificationGap:
      'The dedicated PostgreSQL 127.0.0.1:55436 suite proves two identical rehearsals, exact identity/session continuity, conservative Primary conversion, immutable redacted provenance, no personalization inference, and repeat/crash/concurrency safety; it runs in the PostgreSQL-enabled check job rather than this database-less parity job.',
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
  implemented(
    'matches.replay-analysis',
    'shell-navigation',
    'A temporary invite hides the replay-analysis UI while the public route remains a Soon destination; API authorization remains account-based.',
    ['/matches'],
    [
      'packages/contexts/replay-analysis/index.ts',
      'apps/api/src/routes/replay-analysis.routes.ts',
      'apps/replay-bridge/src/index.ts',
      'apps/web/src/app/matches/ReplayAnalysisPage.tsx',
    ],
    'Needs production VM 104 and browser acceptance evidence.',
  ),
  ...[
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
    id: 'operations.observability',
    area: 'operator-observability',
    requirement:
      'Repository-owned dashboards, fixed retention, quota preflight, and Discord alert rules have executable local firing and recovery evidence.',
    sourceIssue: '#219',
    status: 'verified',
    destinations: [],
    implementation: [
      'deploy/observability/compose.yml',
      'deploy/observability/prometheus/rules/alerts.yml',
      'deploy/observability/grafana/dashboards/operations.json',
      'deploy/observability/grafana/dashboards/http-health.json',
      'deploy/observability/grafana/dashboards/telemetry-storage.json',
      'packages/telemetry/src/node.ts',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'tooling/observability/tests/observability.test.ts',
        assertion:
          'Compose resource limits, retention and quota contracts, dashboards, complete low-cardinality alert inventory, and secret boundaries validate locally.',
      },
      {
        kind: 'unit',
        path: 'tooling/observability/tests/storage-preflight.test.ts',
        assertion:
          'Quota preflight rejects missing/shared mounts, capacity mismatch, low headroom, wrong ownership, and oversized Prometheus retention.',
      },
    ],
  },
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
      'deploy/v3/postgres/configure-dead-letter-role.sh',
      'deploy/v3/run-with-secrets.sh',
      'deploy/v3/compose.yml',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'packages/contexts/refresh-operations/tests/dead-letters.postgres.test.ts',
        assertion:
          'Real PostgreSQL and spawned CLI tests prove authentication, redaction, lineage, concurrency, idempotency, and immutable audit behavior.',
      },
      {
        kind: 'integration',
        path: 'tooling/deployment/tests/v3-topology.test.ts',
        assertion:
          'Profile-gated role provisioning and CLI services expose no ports and receive only dedicated secrets.',
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
    id: 'desktop.windows-lifecycle',
    area: 'desktop-client',
    requirement:
      'The installed desktop observes real Brawlhalla attach, ready, ranked detection, detach, overlay always-on-top and click-through, and tray hide/show/quit without changing normal behavior when evidence is disabled.',
    sourceIssue: '#217',
    status: 'implemented',
    destinations: ['Windows 11 desktop overlay', 'system tray'],
    implementation: [
      'apps/desktop/app/src/windows_acceptance.rs',
      'apps/desktop/app/src/overlay.rs',
      'apps/desktop/app/src/tray.rs',
      'apps/desktop/scripts/windows-acceptance.ps1',
      '.github/workflows/desktop-ci.yml',
    ],
    evidence: [
      {
        kind: 'external',
        path: 'apps/desktop/app/tests/windows_acceptance.rs',
        assertion:
          'Platform-neutral tests prove the probe is opt-in, bounded, identifier-free, one-shot, fail-open, and inert when disabled.',
      },
      {
        kind: 'external',
        path: 'apps/desktop/app/tests/windows_lifecycle.rs',
        assertion: 'Pure overlay hit-testing and reversible tray lifecycle decisions pass on every host.',
      },
      {
        kind: 'external',
        path: 'apps/desktop/smoke/windows-11.pending.json',
        assertion:
          'Supported Windows 11 and representative-hardware observations remain explicitly pending and claim-free.',
      },
    ],
    verificationGap:
      'Run the executable harness on every owner-designated supported Windows 11 release and representative hardware with real Brawlhalla start, attach/ready, ranked detection, detach, overlay/click-through, and tray hide/show/quit. Windows 10 remains best effort and nonblocking.',
  },
  {
    id: 'desktop.api-failure',
    area: 'desktop-client',
    requirement:
      'Generated ranked lookup failures render a truthful unavailable state while the installed desktop remains alive.',
    sourceIssue: '#217',
    status: 'implemented',
    destinations: ['Windows 11 desktop overlay'],
    implementation: [
      'apps/desktop/app/src/api_client.rs',
      'apps/desktop/app/src/detection_bridge.rs',
      'apps/desktop/ui/hooks/useGameEvents.ts',
      'apps/desktop/scripts/windows-acceptance.ps1',
    ],
    evidence: [
      {
        kind: 'external',
        path: 'apps/desktop/app/tests/api_client.rs',
        assertion: 'Generated-client failures reject malformed or failed responses without inventing ranked values.',
      },
      {
        kind: 'unit',
        path: 'apps/desktop/tests/windows-acceptance.test.ts',
        assertion: 'Acceptance requires API failure content to render and the app to answer afterward.',
      },
    ],
    verificationGap:
      'Run the API-failure phase against an unreachable endpoint during a real ranked detection on every supported Windows 11 environment and observe degraded content without process exit.',
  },
  {
    id: 'desktop.opponent-presentation-performance',
    area: 'desktop-client',
    requirement:
      'Opponent information renders with nearest-rank p95 strictly below 2,000 ms from real ranked detection under the owner-approved acceptance workload.',
    sourceIssue: '#217',
    status: 'implemented',
    destinations: ['Windows 11 desktop overlay'],
    implementation: [
      'apps/desktop/app/src/detection_bridge.rs',
      'apps/desktop/app/src/windows_acceptance.rs',
      'apps/desktop/ui/acceptance.ts',
      'apps/desktop/ui/hooks/useGameEvents.ts',
      'apps/desktop/src/windows-acceptance.ts',
      'apps/desktop/scripts/windows-acceptance.ps1',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'apps/desktop/tests/windows-acceptance.test.ts',
        assertion:
          'Known samples prove one-shot render acknowledgement, explicit workload policy, nearest-rank p95, and strict rejection at 2,000 ms.',
      },
    ],
    verificationGap:
      'The owner must define the supported Windows releases, representative hardware, workload ID/mode mix, and minimum sample count, then collect enough real match-to-render samples with p95 below 2,000 ms.',
  },
  {
    id: 'desktop.updater-install',
    area: 'desktop-client',
    requirement:
      'The exact release installer and latest.json signature verify against the committed updater public key before upload, and a previous signed build installs the newer published artifact through the updater path.',
    sourceIssue: '#217',
    status: 'implemented',
    destinations: ['GitHub desktop release', 'Windows 11 updater'],
    implementation: [
      'apps/desktop/app/src/updater_artifact.rs',
      'apps/desktop/app/src/bin/verify_updater_artifact.rs',
      'apps/desktop/scripts/windows-acceptance.ps1',
      '.github/workflows/desktop-release.yml',
    ],
    evidence: [
      {
        kind: 'external',
        path: 'apps/desktop/app/tests/updater_artifact.rs',
        assertion:
          'Public-key verification rejects installer tampering, signature/metadata drift, wrong versions, and insecure URLs without claiming installation.',
      },
      {
        kind: 'external',
        path: 'apps/desktop/smoke/windows-11.pending.json',
        assertion: 'Signed updater installation remains pending rather than inferred from artifact preflight.',
      },
    ],
    verificationGap:
      'Provision the existing external signing credentials and private-submodule read token, then update a real previous signed build to a newer signed published build on supported Windows 11 and observe verification, replacement, relaunch, and installed version.',
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
  {
    id: 'discord.player-command',
    area: 'discord-client',
    requirement:
      '/player acknowledges before network work, consumes canonical identity/ranked/career contracts, refreshes only stale displayed domains, and preserves cached degraded data without invented zeroes.',
    sourceIssue: '#215',
    status: 'verified',
    destinations: ['/player'],
    implementation: [
      'apps/discord-bot/src/commands/player.ts',
      'apps/discord-bot/src/utils/embeds.ts',
      'apps/api/src/router/player.router.ts',
      'packages/contracts/src/refresh-outcome.ts',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'apps/discord-bot/tests/commands/player.test.ts',
        assertion:
          'Full command and select flows cover normal, missing, stale, rate-limited, already-refreshing, temporary failure, defer-first, bounded polling, and expired interactions.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/player-refresh.router.test.ts',
        assertion: 'Trusted Discord actor admission reserves exactly the stale canonical player domains.',
      },
    ],
  },
  {
    id: 'discord.clan-command',
    area: 'discord-client',
    requirement:
      '/clan acknowledges before network work, consumes canonical Discovery and Clans contracts, and preserves independent profile/roster refresh and degraded meanings.',
    sourceIssue: '#215',
    status: 'verified',
    destinations: ['/clan'],
    implementation: ['apps/discord-bot/src/commands/clan.ts', 'apps/discord-bot/src/utils/embeds.ts'],
    evidence: [
      {
        kind: 'unit',
        path: 'apps/discord-bot/tests/commands/clan.test.ts',
        assertion:
          'Full command, select, and pagination flows cover normal, missing, stale, rate-limited, already-refreshing, temporary failure, bounded polling, and expiry.',
      },
    ],
  },
  {
    id: 'discord.status-command',
    area: 'discord-client',
    requirement:
      '/status acknowledges promptly and reports #214 process liveness separately from dependency/schema readiness.',
    sourceIssue: '#215',
    status: 'verified',
    destinations: ['/status'],
    implementation: ['apps/discord-bot/src/commands/status.ts', 'apps/api/src/health-routes.ts'],
    evidence: [
      {
        kind: 'unit',
        path: 'apps/discord-bot/tests/commands/status.test.ts',
        assertion: 'Ready, degraded, unavailable, defer-first, timeout, and probe-failure states render honestly.',
      },
    ],
  },
  {
    id: 'discord.lifecycle-expiry',
    area: 'discord-client',
    requirement:
      'Discord rejects new admission before shutdown drain, keeps interaction correlation bounded, and treats expired interaction/webhook responses as terminal.',
    sourceIssue: '#215',
    status: 'verified',
    destinations: ['/player', '/clan', '/status'],
    implementation: [
      'apps/discord-bot/src/index.ts',
      'apps/discord-bot/src/interaction-runtime.ts',
      'apps/discord-bot/src/interaction-response.ts',
      'apps/discord-bot/src/metrics-server.ts',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'apps/discord-bot/tests/interaction-runtime.test.ts',
        assertion: 'Correlation, rejected admission metrics, bounded drain, and telemetry failure isolation pass.',
      },
      {
        kind: 'unit',
        path: 'apps/discord-bot/tests/metrics-server.test.ts',
        assertion: 'Discord process liveness, readiness, and authenticated metrics remain independently observable.',
      },
    ],
  },
  {
    id: 'discord.smoke-procedures',
    area: 'discord-client',
    requirement:
      'Staging-guild and production smoke preflights are executable, redact credentials, emit evidence artifacts, and leave unexecuted live interaction checks explicitly pending.',
    sourceIssue: '#215',
    status: 'verified',
    destinations: ['staging-guild', 'production'],
    implementation: [
      'apps/discord-bot/src/smoke.ts',
      'apps/discord-bot/smoke/staging-guild.pending.json',
      'apps/discord-bot/smoke/production.pending.json',
      'apps/discord-bot/package.json',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'apps/discord-bot/tests/smoke.test.ts',
        assertion:
          'Both scopes verify command registration and API health without credential disclosure or false live-deployment claims.',
      },
    ],
  },
  {
    id: 'player.v2-facts-history-migration',
    area: 'operator-operations',
    requirement:
      'Players imports V2 identities, scoped facts, and ordered rating history through a resumable checksummed archive without presenting ambiguous defaults as measured zero.',
    sourceIssue: '#222',
    status: 'implemented',
    destinations: ['bun run --filter @brawltome/database-migrations import:players'],
    implementation: [
      'packages/contexts/player/migrations/0007-add-v2-player-import.ts',
      'packages/contexts/player/legacy-import.ts',
      'packages/contexts/player/discovery-postgres.ts',
      'packages/contexts/player/ranked/postgres.ts',
      'tooling/database-migrations/src/import-players.ts',
      'tooling/database-migrations/src/inventories.ts',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'packages/contexts/player/tests/legacy-import.postgres.test.ts',
        assertion:
          'Dedicated PostgreSQL proves exact archive reconciliation, immutable checksums, unknown-zero provenance, ordered history, crash resume, concurrency, repeat safety, rejection evidence, and V0 refresh preservation.',
      },
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/postgres.test.ts',
        assertion:
          'The current 34-row pre-#222 inventory remains an exact applied prefix and Players/0007 appends once.',
      },
    ],
    verificationGap:
      'Two consecutive production-shaped restore rehearsals, storage headroom, elapsed duration, and operator cutover evidence remain external launch gates.',
  },
  {
    id: 'statistics.full-launch-cohort-validation',
    area: 'global-statistics',
    requirement:
      'Global Statistics collects exactly nine launch regions by two rating brackets, validates each product independently, and retains the prior valid immutable publication after rejection.',
    sourceIssue: '#210',
    status: 'verified',
    destinations: ['operations-worker'],
    implementation: [
      'packages/contexts/statistics/cohort.ts',
      'packages/contexts/statistics/publication.ts',
      'packages/contexts/statistics/postgres.ts',
      'packages/contexts/statistics/migrations/0002-full-launch-cohort.ts',
      'packages/contexts/refresh-operations/migrations/0015-add-statistics-publication.ts',
      'apps/api/src/statistics-cohort-reconciliation.ts',
      'apps/api/src/refresh-operations-worker.ts',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contexts/statistics/tests/cohort.test.ts',
        assertion:
          'All 18 cells enforce independent minimums while deterministic selection and the fixed source-capacity envelope remain bounded.',
      },
      {
        kind: 'unit',
        path: 'packages/contexts/statistics/tests/publication.test.ts',
        assertion:
          'Exact 95% overall and 90% per-cell product thresholds audit progress, attempts, successes, observation windows, and capacity.',
      },
      {
        kind: 'integration',
        path: 'apps/api/tests/statistics-full-cohort.postgres.test.ts',
        assertion:
          'Dedicated PostgreSQL proves immutable decisions, independent product publication, prior-valid stale retention, restart, concurrency, replay, and fencing.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/statistics-cohort-reconciliation.test.ts',
        assertion: 'The adapter reads exactly nine pinned regional snapshots and refuses partial source generations.',
      },
    ],
  },
  {
    id: 'clan-ranking.v2-migration',
    area: 'operator-operations',
    requirement:
      'Clans owns reconciled V2 identities, rosters, and memberships, while Rankings promotes only immutable mode and region sets that pass repository-provable completeness, ordering, contestant identity, cardinality, and immutability gates.',
    sourceIssue: '#223',
    status: 'implemented',
    destinations: ['bun run --filter @brawltome/database-migrations import:clans-rankings'],
    implementation: [
      'packages/contexts/clan/migrations/0003-add-v2-import-evidence.ts',
      'packages/contexts/clan/legacy-import.ts',
      'packages/contexts/ranking/migrations/0003-add-v2-legacy-import.ts',
      'packages/contexts/ranking/legacy-import.ts',
      'tooling/database-migrations/src/import-clans.ts',
      'tooling/database-migrations/src/inventories.ts',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/clans-rankings.postgres.test.ts',
        assertion:
          'Dedicated PostgreSQL proves checksummed raw archives, owner provenance, every ranking gate, immutable accepted snapshots, durable rejected sets, frozen-source blocking, crash resume, concurrency, and repeat safety.',
      },
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/postgres.test.ts',
        assertion:
          'The 37-row history through full cohort validation remains an exact prefix before Clans/0003 and Rankings/0003 append once.',
      },
    ],
    verificationGap:
      'Repository fixtures cannot prove upstream V2 collection completeness. Two consecutive production-shaped restore rehearsals, storage headroom, elapsed duration, external backup restoration, and operator cutover evidence remain launch gates.',
  },
  {
    id: 'statistics.current-season-legend-meta',
    area: 'global-statistics',
    requirement:
      'Statistics publishes and renders immutable Current Season Legend Meta with exact observed formulas, eligibility, uncertainty, independent filters, methodology, and prior-valid stale behavior.',
    sourceIssue: '#211',
    status: 'verified',
    destinations: ['/stats', 'statistics.legendMeta', 'operations-worker'],
    implementation: [
      'packages/contexts/statistics/legend-meta.ts',
      'packages/contexts/statistics/postgres.ts',
      'packages/contexts/statistics/migrations/0003-add-legend-meta-publications.ts',
      'packages/contexts/refresh-operations/migrations/0016-add-legend-meta-publication.ts',
      'packages/contracts/src/statistics.ts',
      'apps/api/src/router/statistics.router.ts',
      'apps/web/src/components/statistics/LegendMetaView.tsx',
      'apps/web/src/app/stats/page.tsx',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contexts/statistics/tests/legend-meta.test.ts',
        assertion:
          'Hand-worked fixtures prove exact rational formulas, median, Wilson interval, 30-player/200-game eligibility, zero and missing semantics, deduplication, and all 30 filter slices.',
      },
      {
        kind: 'integration',
        path: 'apps/api/tests/statistics-full-cohort.postgres.test.ts',
        assertion:
          'Dedicated PostgreSQL proves immutable artifact decisions, concurrent fencing, replay identity, last-valid failed-build retention, overdue staleness, and filtered reads.',
      },
      {
        kind: 'unit',
        path: 'packages/contracts/tests/statistics.test.ts',
        assertion:
          'The canonical contract rejects invented percentages, ranks, trends, missing-value zeros, malformed uncertainty, and unsupported filters.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/statistics/LegendMeta.test.tsx',
        assertion:
          'Static rendering proves labeled filters, semantic responsive table structure, announced stale retention, explicit insufficiency, methodology, and non-causal language.',
      },
    ],
  },
  {
    id: 'statistics.career-weapon-usage',
    area: 'global-statistics',
    requirement:
      'Statistics independently publishes immutable Career Weapon Usage from lifetime cohort observations and renders current-bracket scope, coverage, eligibility, uncertainty, stale retention, and missing-versus-zero states without weapon-strength claims.',
    sourceIssue: '#212',
    status: 'verified',
    destinations: ['/stats/career-weapon-usage', 'statistics.careerWeaponUsage', 'operations-worker'],
    implementation: [
      'packages/contexts/statistics/weapon-usage.ts',
      'packages/contexts/statistics/postgres.ts',
      'packages/contexts/statistics/migrations/0004-add-career-weapon-usage.ts',
      'packages/contracts/src/career-weapon-usage.ts',
      'apps/api/src/router/statistics.router.ts',
      'apps/web/src/app/stats/career-weapon-usage/page.tsx',
      'apps/web/src/components/statistics/CareerWeaponUsage.tsx',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contexts/statistics/tests/weapon-usage.test.ts',
        assertion:
          'Worked literals prove exact prevalence, held-time share, median per-player rates, contributor and aggregate gates, measured zero, duplicate rejection, and slot-only attribution.',
      },
      {
        kind: 'integration',
        path: 'apps/api/tests/statistics-full-cohort.postgres.test.ts',
        assertion:
          'Dedicated PostgreSQL proves atomic immutable Career snapshots, all/current filters, independent rejection, stale retention, weekly expiry, restart, replay, fencing, and concurrency.',
      },
      {
        kind: 'unit',
        path: 'packages/contracts/tests/career-weapon-usage.test.ts',
        assertion:
          'The canonical contract preserves exact rational values, measured zero, unavailable rates, strict cohort filters, and explicit stale reasons.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/career-weapon-usage.router.test.ts',
        assertion:
          'The public router reads Statistics only, validates producer output, forwards exact filters, and hides internal publication evidence.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/statistics/CareerWeaponUsage.test.tsx',
        assertion:
          'Rendered output proves labeled filters, honest career/current-bracket copy, all required metrics, formulas, stale and transport warnings, measured zero, unavailable rates, and insufficient evidence.',
      },
    ],
  },
  {
    id: 'statistics.compatible-history',
    area: 'global-statistics',
    requirement:
      'Legend and Career colocate at most eight immutable accepted snapshots with each product, compare only compatible adjacent publications, expose exact canonical non-rank metric deltas with arithmetic direction, retain counts and coverage as snapshot values only, preserve stored eligibility, and stop with stable explanations at the first applicable compatibility break.',
    sourceIssue: '#213',
    status: 'verified',
    destinations: [
      '/stats',
      '/stats/career-weapon-usage',
      'statistics.legendMetaHistory',
      'statistics.careerWeaponUsageHistory',
    ],
    implementation: [
      'packages/contexts/statistics/history.ts',
      'packages/contexts/statistics/postgres.ts',
      'packages/contracts/src/statistics-history.ts',
      'packages/contracts/src/statistics.ts',
      'packages/contracts/src/career-weapon-usage.ts',
      'apps/api/src/router/statistics.router.ts',
      'apps/web/src/components/statistics/LegendMetaHistory.tsx',
      'apps/web/src/components/statistics/CareerWeaponUsageHistory.tsx',
    ],
    evidence: [
      {
        kind: 'unit',
        path: 'packages/contexts/statistics/tests/history.test.ts',
        assertion:
          'Pure tests prove stable compatibility classification, null-season rejection, exact canonical non-rank Legend and Career deltas, immutable eligibility, deterministic depth, and stop-at-first-break traversal.',
      },
      {
        kind: 'integration',
        path: 'apps/api/tests/statistics-full-cohort.postgres.test.ts',
        assertion:
          'Dedicated PostgreSQL proves accepted-only ordering, explicit null-season Legend breaks, compatible Career deltas, rejected-publication exclusion, and restart persistence from immutable publications.',
      },
      {
        kind: 'unit',
        path: 'apps/api/tests/statistics-history.router.test.ts',
        assertion:
          'Product-specific public queries validate canonical history, exact adjacent identity, explicit unavailability, and strict filter forwarding.',
      },
      {
        kind: 'unit',
        path: 'apps/web/tests/components/statistics/StatisticsHistory.test.tsx',
        assertion:
          'Product-colocated history renders stable break explanations, exact units and arithmetic direction, snapshot-only counts and coverage, and lifetime/current-bracket disclosure while independent failures retain the current product view.',
      },
    ],
  },
  {
    id: 'discovery.v2-semantic-migration',
    area: 'operator-operations',
    requirement:
      'Discovery rebuilds only from canonical Players and Clans owner facts, drains replay lag, reconciles exactly, preserves representative routes, and blocks launch on any unexplained V2-to-V3 semantic mismatch.',
    sourceIssue: '#225',
    status: 'implemented',
    destinations: ['bun run --filter @brawltome/database-migrations rebuild:discovery'],
    implementation: [
      'packages/contexts/discovery/migrations/0003-add-semantic-migration-evidence.ts',
      'packages/contexts/discovery/postgres.ts',
      'tooling/database-migrations/src/rebuild-discovery.ts',
      'tooling/database-migrations/src/rebuild-discovery-cli.ts',
      'tooling/database-migrations/src/inventories.ts',
    ],
    evidence: [
      {
        kind: 'integration',
        path: 'packages/contexts/discovery/tests/migration-evidence.postgres.test.ts',
        assertion:
          'Dedicated PostgreSQL proves zero-tolerance immutable evidence, closed explanation codes, deterministic replay, concurrency, and the 1,000-detail mismatch bound.',
      },
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/discovery-rebuild.postgres.test.ts',
        assertion:
          'Two isolated rehearsals produce identical semantic evidence across canonical identity, prefix, normalized exact-name, local-name, negative legacy-only, routes, accepted/rejected rankings, crash restart, replay, and orphan repair.',
      },
      {
        kind: 'integration',
        path: 'tooling/database-migrations/tests/postgres.test.ts',
        assertion: 'Discovery/0003 appends once without changing the complete deployed migration prefix.',
      },
    ],
    verificationGap:
      'The two repository rehearsals use deterministic production-shaped fixtures only. #231 still owns consecutive restored-production rehearsals, storage headroom, elapsed duration, backup restoration, full client smoke checks, and operator cutover evidence.',
  },
]
