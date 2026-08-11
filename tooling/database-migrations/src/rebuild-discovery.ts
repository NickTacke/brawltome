import { createHash } from 'node:crypto'
import { createPostgresClanDiscoverySource, createPostgresClans } from '@brawltome/clan/composition'
import {
  type ClanDiscoveryFact,
  type DiscoverySearchResult,
  type PlayerDiscoveryFact,
  type SemanticMigrationExplanationCode,
  type SemanticMigrationFixture,
  type SemanticMigrationFixtureKind,
  normalizeDiscoveryTerm,
} from '@brawltome/discovery'
import { createPostgresDiscovery } from '@brawltome/discovery/composition'
import { createPostgresPlayerDiscoverySource, createPostgresRankedPlayers } from '@brawltome/player/composition'
import { createPostgresRanking, readLegacyRankingMigrationEvidence } from '@brawltome/ranking/composition'
import postgres from 'postgres'

const playerFixtureLimit = 40
const clanFixtureLimit = 5
const deliveryBatchSize = 1_000
const expectedRankingSetCount = 36

const explanationByKind: Partial<Record<SemanticMigrationFixtureKind, SemanticMigrationExplanationCode>> = {
  'exact-prefix': 'exact-first-ranking',
  'negative-legacy-only': 'legacy-only-not-owner-fact',
  'ranking-rejected': 'ranking-set-rejected',
}

type SearchObservation = {
  players: Array<{ entityId: number; matchedAlias: string | null }>
  clans: number[]
}

type LegacyRouteEvidence = {
  players: Map<number, { entityKind: 'player'; entityId: number }>
  clans: Map<number, { entityKind: 'clan'; entityId: number }>
}

const compareText = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const compareNullableNumberDesc = (left: number | null, right: number | null) => {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return right - left
}
const sameObservation = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function normalizedExactQuery(name: string): string {
  return `  %${name.replace(/\s*\|\s*/g, '|').toUpperCase()}_\\  `
}

function exactPrefix(name: string): string | null {
  const points = [...normalizeDiscoveryTerm(name)]
  if (points.length < 3) return null
  return points.slice(0, Math.max(2, Math.floor(points.length / 2))).join('')
}

function identity<const Kind extends 'player' | 'clan'>(entityKind: Kind, entityId: number) {
  return { entityKind, entityId }
}

function searchObservation(result: DiscoverySearchResult): SearchObservation {
  return {
    players: result.players.map(({ brawlhallaId, matchedAlias }) => ({ entityId: brawlhallaId, matchedAlias })),
    clans: result.clans.map(({ clanId }) => clanId),
  }
}

function expectedSearchObservation(
  rawQuery: string,
  players: readonly PlayerDiscoveryFact[],
  clans: readonly ClanDiscoveryFact[],
): SearchObservation {
  const query = normalizeDiscoveryTerm(rawQuery)
  if ([...query].length < 2) return { players: [], clans: [] }

  type PlayerCandidate = {
    entityId: number
    kind: 'canonical' | 'segment' | 'alias'
    display: string
    normalized: string
    exact: boolean
    rating: number | null
    viewCount: number
  }
  const playerCandidates: PlayerCandidate[] = []
  for (const player of players) {
    const terms: Array<{ kind: PlayerCandidate['kind']; display: string }> = [
      { kind: 'canonical', display: player.name },
      ...player.name
        .split('|')
        .filter((segment) => normalizeDiscoveryTerm(segment) !== normalizeDiscoveryTerm(player.name))
        .map((segment) => ({ kind: 'segment' as const, display: segment.trim() })),
      ...player.aliases.map((alias) => ({ kind: 'alias' as const, display: alias })),
    ]
    const seen = new Set<string>()
    for (const term of terms) {
      const normalized = normalizeDiscoveryTerm(term.display)
      const termIdentity = `${term.kind}:${normalized}`
      if (!normalized || seen.has(termIdentity) || !normalized.startsWith(query)) continue
      seen.add(termIdentity)
      playerCandidates.push({
        entityId: player.brawlhallaId,
        kind: term.kind,
        display: term.display,
        normalized,
        exact: normalized === query,
        rating: player.rating,
        viewCount: player.viewCount,
      })
    }
  }
  const termRank = (kind: PlayerCandidate['kind']) => (kind === 'canonical' ? 0 : kind === 'segment' ? 1 : 2)
  const winnerById = new Map<number, PlayerCandidate>()
  for (const candidate of playerCandidates.sort(
    (left, right) =>
      left.entityId - right.entityId ||
      Number(right.exact) - Number(left.exact) ||
      Number(left.kind === 'alias') - Number(right.kind === 'alias') ||
      termRank(left.kind) - termRank(right.kind) ||
      compareText(left.normalized, right.normalized) ||
      compareText(left.display, right.display),
  )) {
    if (!winnerById.has(candidate.entityId)) winnerById.set(candidate.entityId, candidate)
  }
  const expectedPlayers = [...winnerById.values()]
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        Number(left.kind === 'alias') - Number(right.kind === 'alias') ||
        compareNullableNumberDesc(left.rating, right.rating) ||
        right.viewCount - left.viewCount ||
        left.entityId - right.entityId,
    )
    .slice(0, 40)
    .map(({ entityId, kind, display }) => ({ entityId, matchedAlias: kind === 'alias' ? display : null }))

  const expectedClans = clans
    .map((clan) => ({ clan, normalized: normalizeDiscoveryTerm(clan.clanName) }))
    .filter(({ normalized }) => normalized.startsWith(query))
    .sort(
      (left, right) =>
        Number(right.normalized === query) - Number(left.normalized === query) ||
        (BigInt(left.clan.clanXp) < BigInt(right.clan.clanXp)
          ? 1
          : BigInt(left.clan.clanXp) > BigInt(right.clan.clanXp)
            ? -1
            : left.clan.clanId - right.clan.clanId),
    )
    .slice(0, 5)
    .map(({ clan }) => clan.clanId)

  return { players: expectedPlayers, clans: expectedClans }
}

function historicalQuery(rawQuery: string): string {
  return rawQuery
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/[%\\_]/g, '')
    .trim()
}

async function legacySearch(client: ReturnType<typeof postgres>, rawQuery: string): Promise<SearchObservation> {
  const query = historicalQuery(rawQuery)
  if (query.length < 2) return { players: [], clans: [] }
  const nameMatches = await client<Array<{ brawlhalla_id: number; rating: number; view_count: number }>>`
    SELECT brawlhalla_id, rating, view_count FROM public.player
    WHERE name ILIKE ${`${query}%`} OR name ILIKE ${`% | ${query}%`}
    ORDER BY rating DESC, view_count DESC, brawlhalla_id
    LIMIT 50
  `
  const aliases = await client<Array<{ brawlhalla_id: number; alias: string }>>`
    SELECT brawlhalla_id, value AS alias FROM public.player_alias
    WHERE key ILIKE ${`${query.toLowerCase()}%`}
    ORDER BY brawlhalla_id, created_at DESC, key COLLATE "C"
    LIMIT 50
  `
  const aliasById = new Map<number, string>()
  for (const alias of aliases) if (!aliasById.has(alias.brawlhalla_id)) aliasById.set(alias.brawlhalla_id, alias.alias)
  const nameIds = new Set(nameMatches.map(({ brawlhalla_id }) => brawlhalla_id))
  const aliasIds = [...aliasById.keys()].filter((id) => !nameIds.has(id))
  const aliasMatches =
    aliasIds.length === 0
      ? []
      : await client<Array<{ brawlhalla_id: number; rating: number }>>`
          SELECT brawlhalla_id, rating FROM public.player
          WHERE brawlhalla_id IN ${client(aliasIds)}
          ORDER BY rating DESC, brawlhalla_id
          LIMIT 20
        `
  const players = [
    ...nameMatches.map(({ brawlhalla_id }) => ({ entityId: brawlhalla_id, matchedAlias: null })),
    ...aliasMatches.map(({ brawlhalla_id }) => ({
      entityId: brawlhalla_id,
      matchedAlias: aliasById.get(brawlhalla_id) ?? null,
    })),
  ].slice(0, 40)
  const legacyClans = await client<Array<{ clan_id: number }>>`
    SELECT clan_id FROM public.clan
    WHERE clan_name ILIKE ${`${query}%`}
    ORDER BY clan_xp DESC, clan_id
    LIMIT 5
  `
  return { players, clans: legacyClans.map(({ clan_id }) => clan_id) }
}

async function legacyRoutes(client: ReturnType<typeof postgres>): Promise<LegacyRouteEvidence> {
  const [players, clans] = await Promise.all([
    client<{ brawlhalla_id: number }[]>`SELECT brawlhalla_id FROM public.player ORDER BY brawlhalla_id`,
    client<{ clan_id: number }[]>`SELECT clan_id FROM public.clan ORDER BY clan_id`,
  ])
  return {
    players: new Map(players.map(({ brawlhalla_id }) => [brawlhalla_id, identity('player', brawlhalla_id)])),
    clans: new Map(clans.map(({ clan_id }) => [clan_id, identity('clan', clan_id)])),
  }
}

async function drainPlayerEvents(
  source: ReturnType<typeof createPostgresPlayerDiscoverySource>,
  discovery: ReturnType<typeof createPostgresDiscovery>,
): Promise<void> {
  while ((await source.lag()) > 0) {
    const delivered = await discovery.deliverPendingPlayers(source, deliveryBatchSize)
    if (delivered.eventIds.length === 0) throw new Error('Player projection lag did not make progress')
  }
}

async function drainClanEvents(
  source: ReturnType<typeof createPostgresClanDiscoverySource>,
  discovery: ReturnType<typeof createPostgresDiscovery>,
): Promise<void> {
  while ((await source.lag()) > 0) {
    const delivered = await discovery.deliverPendingClans(source, deliveryBatchSize)
    if (delivered.eventIds.length === 0) throw new Error('Clan projection lag did not make progress')
  }
}

export type RebuildMigratedDiscoveryResult = {
  operationKey: string
  inputHash: string
  sourceEvidenceHash: string
  status: 'passed' | 'blocked'
  playerSourceVersion: number
  clanSourceVersion: number
  playerFactCount: number
  clanFactCount: number
  pendingPlayerEvents: number
  pendingClanEvents: number
  playerProjectionHash: string
  clanProjectionHash: string
  fixtureHash: string
  fixtureCount: number
  intentionalDifferenceCount: number
  unexplainedMismatchCount: number
  mismatchDetailCount: number
  mismatchDetailsTruncated: boolean
  semanticCounts: Record<SemanticMigrationFixtureKind, number>
  mismatches: Array<{ fixtureKey: string; fixtureKind: SemanticMigrationFixtureKind; reason: string }>
}

export async function rebuildMigratedDiscovery(connectionString: string): Promise<RebuildMigratedDiscoveryResult> {
  const playerSource = createPostgresPlayerDiscoverySource(connectionString)
  const clanSource = createPostgresClanDiscoverySource(connectionString)
  const playerQueries = createPostgresRankedPlayers(connectionString)
  const clanQueries = createPostgresClans(connectionString)
  const ranking = createPostgresRanking(connectionString)
  const discovery = createPostgresDiscovery(connectionString)
  const legacy = postgres(connectionString, { max: 1 })
  let legacyTransactionOpen = false
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await Promise.all([discovery.rebuildPlayersFrom(playerSource), discovery.rebuildClansFrom(clanSource)])
      await Promise.all([drainPlayerEvents(playerSource, discovery), drainClanEvents(clanSource, discovery)])

      await legacy.unsafe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      legacyTransactionOpen = true
      const [playerSnapshot, clanSnapshot, playerMigration, clanMigration, rankingMigration, routes] =
        await Promise.all([
          playerSource.snapshot(),
          clanSource.snapshot(),
          playerSource.legacyMigrationEvidence(),
          clanQueries.legacyMigrationEvidence(),
          readLegacyRankingMigrationEvidence(connectionString),
          legacyRoutes(legacy),
        ])
      if (
        playerMigration.status !== 'complete' ||
        clanMigration.status !== 'complete' ||
        rankingMigration.status !== 'complete' ||
        !playerMigration.sourceChecksum ||
        !clanMigration.sourceChecksum ||
        !rankingMigration.sourceChecksum
      ) {
        throw new Error('Discovery rebuild requires complete Players, Clans, and Rankings imports')
      }
      if (rankingMigration.sets.length !== expectedRankingSetCount) {
        throw new Error(`Discovery rebuild requires exactly ${expectedRankingSetCount} Ranking migration sets`)
      }

      const fixtures: SemanticMigrationFixture[] = []
      const canonicalPlayerIds = new Set(playerSnapshot.facts.map(({ brawlhallaId }) => brawlhallaId))
      const canonicalClanIds = new Set(clanSnapshot.facts.map(({ clanId }) => clanId))
      const addSearchFixture = async (key: string, kind: SemanticMigrationFixtureKind, query: string) => {
        const [unfilteredLegacy, actualResult] = await Promise.all([
          legacySearch(legacy, query),
          discovery.search(query),
        ])
        const legacyObservation = {
          players: unfilteredLegacy.players.filter(({ entityId }) => canonicalPlayerIds.has(entityId)),
          clans: unfilteredLegacy.clans.filter((entityId) => canonicalClanIds.has(entityId)),
        }
        const expected = expectedSearchObservation(query, playerSnapshot.facts, clanSnapshot.facts)
        const actual = searchObservation(actualResult)
        fixtures.push({
          key,
          kind,
          expected,
          legacy: legacyObservation,
          actual,
          explanationCode: sameObservation(legacyObservation, actual) ? null : (explanationByKind[kind] ?? null),
        })
      }

      const legacyBackedPlayers = playerSnapshot.facts
        .filter(({ brawlhallaId }) => routes.players.has(brawlhallaId))
        .slice(0, playerFixtureLimit)
      const legacyBackedClans = clanSnapshot.facts
        .filter(({ clanId }) => routes.clans.has(clanId))
        .slice(0, clanFixtureLimit)

      for (const fact of legacyBackedPlayers) {
        const expectedIdentity = identity('player', fact.brawlhallaId)
        const [legacyResult, actualResult, route] = await Promise.all([
          legacySearch(legacy, fact.name),
          discovery.search(fact.name),
          playerQueries.referenceById(fact.brawlhallaId),
        ])
        fixtures.push({
          key: `player:${fact.brawlhallaId}:canonical`,
          kind: 'canonical-identity',
          expected: expectedIdentity,
          legacy: legacyResult.players.some(({ entityId }) => entityId === fact.brawlhallaId) ? expectedIdentity : null,
          actual: actualResult.players.some(({ brawlhallaId }) => brawlhallaId === fact.brawlhallaId)
            ? expectedIdentity
            : null,
          explanationCode: null,
        })
        fixtures.push({
          key: `player:${fact.brawlhallaId}:route`,
          kind: 'preserved-route',
          expected: expectedIdentity,
          legacy: routes.players.get(fact.brawlhallaId) ?? null,
          actual: route ? identity('player', route.brawlhallaId) : null,
          explanationCode: null,
        })
        const prefix = exactPrefix(fact.name)
        if (prefix) await addSearchFixture(`player:${fact.brawlhallaId}:exact-prefix`, 'exact-prefix', prefix)
      }

      for (const fact of legacyBackedClans) {
        const expectedIdentity = identity('clan', fact.clanId)
        const [legacyResult, actualResult, route] = await Promise.all([
          legacySearch(legacy, fact.clanName),
          discovery.search(fact.clanName),
          clanQueries.getById(fact.clanId),
        ])
        fixtures.push({
          key: `clan:${fact.clanId}:canonical`,
          kind: 'canonical-identity',
          expected: expectedIdentity,
          legacy: legacyResult.clans.includes(fact.clanId) ? expectedIdentity : null,
          actual: actualResult.clans.some(({ clanId }) => clanId === fact.clanId) ? expectedIdentity : null,
          explanationCode: null,
        })
        fixtures.push({
          key: `clan:${fact.clanId}:route`,
          kind: 'preserved-route',
          expected: expectedIdentity,
          legacy: routes.clans.get(fact.clanId) ?? null,
          actual: route ? identity('clan', route.clanId) : null,
          explanationCode: null,
        })
        const prefix = exactPrefix(fact.clanName)
        if (prefix) await addSearchFixture(`clan:${fact.clanId}:exact-prefix`, 'exact-prefix', prefix)
      }

      const normalizedPlayer = legacyBackedPlayers[0]
      const normalizedClan = legacyBackedClans[0]
      if (normalizedPlayer) {
        await addSearchFixture(
          `player:${normalizedPlayer.brawlhallaId}:normalized-exact-name`,
          'normalized-exact-name',
          normalizedExactQuery(normalizedPlayer.name),
        )
      } else if (normalizedClan) {
        await addSearchFixture(
          `clan:${normalizedClan.clanId}:normalized-exact-name`,
          'normalized-exact-name',
          normalizedExactQuery(normalizedClan.clanName),
        )
      }
      const localNameFact = legacyBackedPlayers.find(({ name }) => name.includes('|'))
      if (localNameFact) {
        const localName = localNameFact.name.split('|').at(-1)?.trim() ?? ''
        if ([...normalizeDiscoveryTerm(localName)].length >= 2) {
          await addSearchFixture(`player:${localNameFact.brawlhallaId}:local-name`, 'local-name', localName)
        }
      }

      for (const rejected of playerMigration.rejectedIdentities.slice(0, playerFixtureLimit)) {
        const [legacyResult, actualResult] = await Promise.all([
          legacySearch(legacy, rejected.playerName),
          discovery.search(rejected.playerName),
        ])
        fixtures.push({
          key: `player:${rejected.brawlhallaId}:legacy-only`,
          kind: 'negative-legacy-only',
          expected: false,
          legacy: legacyResult.players.some(({ entityId }) => entityId === rejected.brawlhallaId),
          actual: actualResult.players.some(({ brawlhallaId }) => brawlhallaId === rejected.brawlhallaId),
          explanationCode: 'legacy-only-not-owner-fact',
        })
      }
      for (const rejected of clanMigration.rejectedIdentities.slice(0, clanFixtureLimit)) {
        const [legacyResult, actualResult] = await Promise.all([
          legacySearch(legacy, rejected.clanName),
          discovery.search(rejected.clanName),
        ])
        fixtures.push({
          key: `clan:${rejected.clanId}:legacy-only`,
          kind: 'negative-legacy-only',
          expected: false,
          legacy: legacyResult.clans.includes(rejected.clanId),
          actual: actualResult.clans.some(({ clanId }) => clanId === rejected.clanId),
          explanationCode: 'legacy-only-not-owner-fact',
        })
      }

      await legacy.unsafe('COMMIT')
      legacyTransactionOpen = false

      for (const set of rankingMigration.sets) {
        if (set.status === 'accepted') {
          const view = set.snapshotId
            ? await ranking.queries.getLeaderboard({
                mode: set.mode,
                region: set.scope,
                page: 1,
                pageSize: 100,
                snapshotId: set.snapshotId,
              })
            : null
          const expected = { mode: set.mode, scope: set.scope, totalRows: set.rowCount, entries: set.entries }
          const actual =
            !view || view.status === 'unavailable'
              ? null
              : { mode: view.mode, scope: view.region, totalRows: view.totalRows, entries: view.entries }
          fixtures.push({
            key: `ranking:${set.mode}:${set.scope}:accepted`,
            kind: 'ranking-accepted',
            expected,
            legacy: expected,
            actual,
            explanationCode: null,
          })
        } else {
          fixtures.push({
            key: `ranking:${set.mode}:${set.scope}:rejected`,
            kind: 'ranking-rejected',
            expected: null,
            legacy: { status: 'rejected', reasons: set.reasons, sourceChecksum: set.sourceChecksum },
            actual: set.snapshotId ? { snapshotId: set.snapshotId } : null,
            explanationCode: 'ranking-set-rejected',
          })
        }
      }

      const [playerReconciliation, clanReconciliation] = await Promise.all([
        discovery.reconcilePlayers(playerSource),
        discovery.reconcileClans(clanSource),
      ])
      const [finalPlayerSnapshot, finalClanSnapshot, pendingPlayerEvents, pendingClanEvents] = await Promise.all([
        playerSource.snapshot(),
        clanSource.snapshot(),
        playerSource.lag(),
        clanSource.lag(),
      ])
      const sourceStable =
        finalPlayerSnapshot.sourceVersion === playerSnapshot.sourceVersion &&
        finalClanSnapshot.sourceVersion === clanSnapshot.sourceVersion &&
        sameObservation(finalPlayerSnapshot.facts, playerSnapshot.facts) &&
        sameObservation(finalClanSnapshot.facts, clanSnapshot.facts)
      if (!sourceStable || pendingPlayerEvents !== 0 || pendingClanEvents !== 0) {
        if (attempt === 2) throw new Error('Discovery owner facts changed during migration verification')
        continue
      }

      const sourceEvidenceHash = createHash('sha256')
        .update(
          [playerMigration.sourceChecksum, clanMigration.sourceChecksum, rankingMigration.sourceChecksum].join(':'),
        )
        .digest('hex')
      const operationKey = [
        'issue-225:v1',
        playerSnapshot.sourceVersion,
        clanSnapshot.sourceVersion,
        sourceEvidenceHash,
      ].join(':')
      const evidence = await discovery.commitMigrationEvidence(
        {
          operationKey,
          sourceEvidenceHash,
          playerReconciliation,
          clanReconciliation,
          pendingPlayerEvents,
          pendingClanEvents,
          fixtures,
        },
        async () => {
          const [authorizedPlayers, authorizedClans, playerLag, clanLag] = await Promise.all([
            playerSource.snapshot(),
            clanSource.snapshot(),
            playerSource.lag(),
            clanSource.lag(),
          ])
          return (
            playerLag === 0 &&
            clanLag === 0 &&
            authorizedPlayers.sourceVersion === playerSnapshot.sourceVersion &&
            authorizedClans.sourceVersion === clanSnapshot.sourceVersion &&
            sameObservation(authorizedPlayers.facts, playerSnapshot.facts) &&
            sameObservation(authorizedClans.facts, clanSnapshot.facts)
          )
        },
      )
      const semanticCounts = Object.fromEntries(
        [
          'canonical-identity',
          'exact-prefix',
          'normalized-exact-name',
          'local-name',
          'negative-legacy-only',
          'preserved-route',
          'ranking-accepted',
          'ranking-rejected',
        ].map((kind) => [kind, fixtures.filter((fixture) => fixture.kind === kind).length]),
      ) as Record<SemanticMigrationFixtureKind, number>
      return {
        operationKey,
        inputHash: evidence.inputHash,
        sourceEvidenceHash: evidence.sourceEvidenceHash,
        status: evidence.status,
        playerSourceVersion: playerSnapshot.sourceVersion,
        clanSourceVersion: clanSnapshot.sourceVersion,
        playerFactCount: playerSnapshot.facts.length,
        clanFactCount: clanSnapshot.facts.length,
        pendingPlayerEvents,
        pendingClanEvents,
        playerProjectionHash: evidence.playerProjectionHash,
        clanProjectionHash: evidence.clanProjectionHash,
        fixtureHash: evidence.fixtureHash,
        fixtureCount: evidence.fixtureCount,
        intentionalDifferenceCount: evidence.intentionalDifferenceCount,
        unexplainedMismatchCount: evidence.unexplainedMismatchCount,
        mismatchDetailCount: evidence.mismatchDetailCount,
        mismatchDetailsTruncated: evidence.mismatchDetailsTruncated,
        semanticCounts,
        mismatches: evidence.mismatches.map(({ fixtureKey, fixtureKind, reason }) => ({
          fixtureKey,
          fixtureKind,
          reason,
        })),
      }
    }
    throw new Error('Discovery rebuild exhausted source-stability retries')
  } finally {
    if (legacyTransactionOpen) await legacy.unsafe('ROLLBACK').catch(() => undefined)
    await Promise.all([
      playerSource.close(),
      clanSource.close(),
      playerQueries.close(),
      clanQueries.close(),
      ranking.close(),
      discovery.close(),
      legacy.end(),
    ])
  }
}
