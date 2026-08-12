import { createHash } from 'node:crypto'
import postgres from 'postgres'
import {
  type ClanDiscoveryFact,
  type ClanProjectionEvent,
  type ClanProjectionSnapshot,
  type ClanProjectionSource,
  type ClanSearchHit,
  type DiscoveryQueries,
  type MigrationEvidenceInput,
  type MigrationEvidenceResult,
  type PlayerDiscoveryFact,
  type PlayerProjectionEvent,
  type PlayerProjectionSnapshot,
  type PlayerProjectionSource,
  type PlayerSearchHit,
  type ProjectionOwner,
  type ReconciliationDifference,
  type ReconciliationResult,
  type SemanticMigrationExplanationCode,
  type SemanticMigrationFixture,
  type SemanticMigrationFixtureKind,
  type SemanticMigrationMismatch,
  normalizeDiscoveryTerm,
} from './index'

type Sql = ReturnType<typeof postgres>
type PlayerTerm = { kind: 'canonical' | 'segment' | 'alias'; display: string; normalized: string }
type TermRow = {
  entity_kind: ProjectionOwner
  generation_id: string
  entity_id: number
  term_kind: string
  display_term: string
  normalized_term: string
  canonical_name: string
  region: string | null
  rating: number | null
  view_count: number | null
  best_legend_name_key: string | null
  clan_xp: string | null
  member_count: number | null
}

const termInsertBatchSize = 4_000

class StaleProjectionSnapshotError extends Error {}

function playerTermsFor(fact: PlayerDiscoveryFact): PlayerTerm[] {
  const terms: PlayerTerm[] = []
  const seen = new Set<string>()
  const add = (kind: PlayerTerm['kind'], display: string) => {
    const normalized = normalizeDiscoveryTerm(display)
    const identity = `${kind}:${normalized}`
    if (!normalized || seen.has(identity)) return
    seen.add(identity)
    terms.push({ kind, display, normalized })
  }

  add('canonical', fact.name)
  for (const segment of fact.name.split('|')) {
    if (normalizeDiscoveryTerm(segment) !== normalizeDiscoveryTerm(fact.name)) add('segment', segment.trim())
  }
  for (const alias of fact.aliases) add('alias', alias)
  return terms
}

function playerTermRows(generationId: string, fact: PlayerDiscoveryFact): TermRow[] {
  return playerTermsFor(fact).map((term) => ({
    entity_kind: 'player',
    generation_id: generationId,
    entity_id: fact.brawlhallaId,
    term_kind: term.kind,
    display_term: term.display,
    normalized_term: term.normalized,
    canonical_name: fact.name,
    region: fact.region,
    rating: fact.rating,
    view_count: fact.viewCount,
    best_legend_name_key: fact.bestLegendNameKey,
    clan_xp: null,
    member_count: null,
  }))
}

async function replacePlayer(sql: Sql, generationId: string, fact: PlayerDiscoveryFact | null, brawlhallaId: number) {
  await sql`
    DELETE FROM discovery.terms
    WHERE entity_kind = 'player' AND generation_id = ${generationId} AND entity_id = ${brawlhallaId}
  `
  if (!fact) return
  const rows = playerTermRows(generationId, fact)
  if (rows.length > 0) await sql`INSERT INTO discovery.terms ${sql(rows)}`
}

const maxPersistedReconciliationDifferences = 1_000
const maxPersistedSemanticMigrationMismatches = 1_000
const maxSemanticMigrationFixtures = 5_000
const maxSemanticMigrationFixtureBytes = 32 * 1_024
const maxSemanticMigrationManifestBytes = 5 * 1_024 * 1_024
const maxSemanticMigrationValueDepth = 16

const semanticMigrationFixtureKinds = [
  'canonical-identity',
  'exact-prefix',
  'normalized-exact-name',
  'local-name',
  'negative-legacy-only',
  'preserved-route',
  'ranking-accepted',
  'ranking-rejected',
] as const satisfies readonly SemanticMigrationFixtureKind[]

const allowedExplanationByKind: Partial<Record<SemanticMigrationFixtureKind, SemanticMigrationExplanationCode>> = {
  'exact-prefix': 'exact-first-ranking',
  'negative-legacy-only': 'legacy-only-not-owner-fact',
  'ranking-rejected': 'ranking-set-rejected',
}

function stableJson(value: unknown, ancestors = new Set<object>(), depth = 0): string {
  if (depth > maxSemanticMigrationValueDepth) throw new Error('Discovery migration fixture values are too deep')
  if (value === null) return 'null'
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Discovery migration fixture values must be finite JSON data')
  }
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    const serialized = JSON.stringify(value)
    if (serialized !== undefined) return serialized
  }
  if (typeof value !== 'object') throw new Error('Discovery migration fixture values must be finite JSON data')
  if (ancestors.has(value)) throw new Error('Discovery migration fixture values must not contain cycles')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const items: string[] = []
      for (let index = 0; index < value.length; index++) {
        if (!(index in value)) throw new Error('Discovery migration fixture arrays must not be sparse')
        items.push(stableJson(value[index], ancestors, depth + 1))
      }
      return `[${items.join(',')}]`
    }
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item, ancestors, depth + 1)}`)
      .join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

const semanticHash = (serialized: string) => createHash('sha256').update(serialized).digest('hex')
const semanticEqual = (left: unknown, right: unknown) => stableJson(left) === stableJson(right)
const compareSemanticFixture = (left: SemanticMigrationFixture, right: SemanticMigrationFixture) =>
  Buffer.compare(Buffer.from(left.key), Buffer.from(right.key))

function validateAndOrderSemanticFixtures(fixtures: SemanticMigrationFixture[]): {
  orderedFixtures: SemanticMigrationFixture[]
  serializedManifest: string
} {
  if (fixtures.length < 1 || fixtures.length > maxSemanticMigrationFixtures) {
    throw new Error(`Discovery migration requires between 1 and ${maxSemanticMigrationFixtures} fixtures`)
  }
  const orderedFixtures = [...fixtures].sort(compareSemanticFixture)
  const keys = new Set<string>()
  const observedKinds = new Set<SemanticMigrationFixtureKind>()
  let manifestBytes = 2
  for (const fixture of orderedFixtures) {
    if (!fixture.key || fixture.key.length > 256 || keys.has(fixture.key)) {
      throw new Error('Discovery migration fixture keys must be unique and between 1 and 256 characters')
    }
    if (!(semanticMigrationFixtureKinds as readonly string[]).includes(fixture.kind)) {
      throw new Error('Discovery migration fixture kind is unsupported')
    }
    keys.add(fixture.key)
    observedKinds.add(fixture.kind)
    const serialized = stableJson(fixture)
    const bytes = Buffer.byteLength(serialized)
    if (bytes > maxSemanticMigrationFixtureBytes) throw new Error('Discovery migration fixture is too large')
    manifestBytes += bytes + 1
    if (manifestBytes > maxSemanticMigrationManifestBytes) {
      throw new Error('Discovery migration fixture manifest is too large')
    }
  }
  const missingKinds = semanticMigrationFixtureKinds.filter((kind) => !observedKinds.has(kind))
  if (missingKinds.length > 0) {
    throw new Error(`Discovery migration fixture coverage is missing: ${missingKinds.join(', ')}`)
  }
  return { orderedFixtures, serializedManifest: stableJson(orderedFixtures) }
}

function classifySemanticFixtures(fixtures: SemanticMigrationFixture[]): {
  intentionalDifferenceCount: number
  mismatches: SemanticMigrationMismatch[]
} {
  let intentionalDifferenceCount = 0
  const mismatches: SemanticMigrationMismatch[] = []
  for (const fixture of fixtures) {
    const expectedExplanation = allowedExplanationByKind[fixture.kind]
    if (fixture.explanationCode !== null && fixture.explanationCode !== expectedExplanation) {
      throw new Error('Explanation code does not match semantic fixture kind')
    }
    const legacyDiffers = !semanticEqual(fixture.legacy, fixture.actual)
    const actualMatches = semanticEqual(fixture.expected, fixture.actual)
    if (!actualMatches) {
      mismatches.push({
        fixtureKey: fixture.key,
        fixtureKind: fixture.kind,
        explanationCode: fixture.explanationCode,
        expected: fixture.expected,
        legacy: fixture.legacy,
        actual: fixture.actual,
        reason: 'actual-does-not-match-canonical-expectation',
      })
      continue
    }
    if (!legacyDiffers) {
      if (fixture.explanationCode !== null) {
        throw new Error('Semantic fixture explanation requires an observed legacy difference')
      }
      continue
    }
    const legacySearchIdentitySet = (value: unknown): string | null => {
      if (!value || typeof value !== 'object') return null
      const observation = value as { players?: unknown; clans?: unknown }
      if (!Array.isArray(observation.players) || !Array.isArray(observation.clans)) return null
      const playerIds = observation.players
        .map((player) =>
          player && typeof player === 'object' && typeof (player as { entityId?: unknown }).entityId === 'number'
            ? (player as { entityId: number }).entityId
            : null,
        )
        .filter((entityId): entityId is number => entityId !== null)
        .sort((left, right) => left - right)
      const clanIds = observation.clans
        .filter((entityId): entityId is number => typeof entityId === 'number')
        .sort((left, right) => left - right)
      if (playerIds.length !== observation.players.length || clanIds.length !== observation.clans.length) return null
      return stableJson({ playerIds, clanIds })
    }
    const exactFirstDifferenceIsOnlyOrdering =
      fixture.kind === 'exact-prefix' &&
      legacySearchIdentitySet(fixture.legacy) !== null &&
      legacySearchIdentitySet(fixture.legacy) === legacySearchIdentitySet(fixture.actual)
    const explainedOwnerRejection =
      (fixture.kind === 'negative-legacy-only' || fixture.kind === 'ranking-rejected') &&
      semanticEqual(fixture.expected, fixture.actual) &&
      !semanticEqual(fixture.legacy, fixture.actual)
    const explanationIsMechanical =
      fixture.explanationCode === expectedExplanation && (exactFirstDifferenceIsOnlyOrdering || explainedOwnerRejection)
    if (!explanationIsMechanical) {
      mismatches.push({
        fixtureKey: fixture.key,
        fixtureKind: fixture.kind,
        explanationCode: fixture.explanationCode,
        expected: fixture.expected,
        legacy: fixture.legacy,
        actual: fixture.actual,
        reason: 'legacy-difference-is-unexplained',
      })
      continue
    }
    intentionalDifferenceCount++
  }
  return { intentionalDifferenceCount, mismatches }
}

async function replaceClan(sql: Sql, generationId: string, fact: ClanDiscoveryFact | null, clanId: number) {
  await sql`
    DELETE FROM discovery.terms
    WHERE entity_kind = 'clan' AND generation_id = ${generationId} AND entity_id = ${clanId}
  `
  if (!fact) return
  const normalized = normalizeDiscoveryTerm(fact.clanName)
  if (!normalized) return
  await sql`
    INSERT INTO discovery.terms
      (entity_kind, generation_id, entity_id, term_kind, display_term, normalized_term,
       canonical_name, clan_xp, member_count)
    VALUES
      ('clan', ${generationId}, ${fact.clanId}, 'canonical', ${fact.clanName}, ${normalized},
       ${fact.clanName}, ${fact.clanXp}, ${fact.memberCount})
  `
}

async function replaceGeneration(
  sql: Sql,
  owner: ProjectionOwner,
  snapshot: PlayerProjectionSnapshot | ClanProjectionSnapshot,
): Promise<void> {
  const [generation] = await sql<{ generation_id: string }[]>`
    INSERT INTO discovery.generations (entity_kind, source_version)
    VALUES (${owner}, ${snapshot.sourceVersion}) RETURNING generation_id
  `
  if (owner === 'player') {
    const rows: TermRow[] = []
    for (const fact of [...(snapshot as PlayerProjectionSnapshot).facts].sort(
      (left, right) => left.brawlhallaId - right.brawlhallaId,
    )) {
      for (const row of playerTermRows(generation.generation_id, fact)) {
        rows.push(row)
        if (rows.length === termInsertBatchSize) {
          await sql`INSERT INTO discovery.terms ${sql(rows)}`
          rows.length = 0
        }
      }
    }
    if (rows.length > 0) await sql`INSERT INTO discovery.terms ${sql(rows)}`
  } else {
    for (const fact of [...(snapshot as ClanProjectionSnapshot).facts].sort(
      (left, right) => left.clanId - right.clanId,
    )) {
      await replaceClan(sql, generation.generation_id, fact, fact.clanId)
    }
  }
  await sql`UPDATE discovery.generations SET active = false WHERE entity_kind = ${owner} AND active`
  await sql`
    UPDATE discovery.generations SET active = true
    WHERE entity_kind = ${owner} AND generation_id = ${generation.generation_id}
  `
  await sql`DELETE FROM discovery.generations WHERE entity_kind = ${owner} AND NOT active`
}

export function createPostgresDiscovery(connectionString: string): DiscoveryQueries & {
  applyPlayerEvents(
    events: PlayerProjectionEvent[],
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ): Promise<{ appliedEvents: number }>
  applyClanEvents(
    events: ClanProjectionEvent[],
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ): Promise<{ appliedEvents: number }>
  deliverPendingPlayers(
    source: PlayerProjectionSource,
    limit: number,
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ): Promise<{ appliedEvents: number; eventIds: string[] }>
  deliverPendingClans(
    source: ClanProjectionSource,
    limit: number,
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ): Promise<{ appliedEvents: number; eventIds: string[] }>
  rebuildPlayers(snapshot: PlayerProjectionSnapshot): Promise<void>
  rebuildClans(snapshot: ClanProjectionSnapshot): Promise<void>
  rebuildPlayersFrom(source: PlayerProjectionSource): Promise<void>
  rebuildClansFrom(source: ClanProjectionSource): Promise<void>
  reconcilePlayers(
    source: PlayerProjectionSource,
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ): Promise<ReconciliationResult>
  reconcileClans(
    source: ClanProjectionSource,
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ): Promise<ReconciliationResult>
  reconciliationDue(owner: ProjectionOwner, intervalMs: number): Promise<boolean>
  reconciliationEffectApplied(operationId: string): Promise<boolean>
  playerProjectionEffectState(operationId: string): Promise<'none' | 'applied' | 'acknowledged'>
  clanProjectionEffectState(operationId: string): Promise<'none' | 'applied' | 'acknowledged'>
  commitMigrationEvidence(
    input: MigrationEvidenceInput,
    authorizeEvidence?: () => Promise<boolean>,
  ): Promise<MigrationEvidenceResult>
  close(): Promise<void>
} {
  const client = postgres(connectionString)

  async function searchPlayers(rawQuery: string): Promise<PlayerSearchHit[]> {
    const query = normalizeDiscoveryTerm(rawQuery)
    if ([...query].length < 2) return []
    const upperBound = `${query}\u{10ffff}`
    const rows = await client<
      Array<{
        entity_id: number
        canonical_name: string
        region: string | null
        rating: number | null
        view_count: number
        best_legend_name_key: string | null
        term_kind: PlayerTerm['kind']
        display_term: string
      }>
    >`
      WITH candidates AS (
        SELECT term.*,
               term.normalized_term = ${query} COLLATE "C" AS exact_match,
               CASE WHEN term.term_kind = 'alias' THEN 1 ELSE 0 END AS alias_rank,
               CASE term.term_kind WHEN 'canonical' THEN 0 WHEN 'segment' THEN 1 ELSE 2 END AS stable_term_rank
        FROM discovery.terms term
        JOIN discovery.generations generation
          ON generation.entity_kind = term.entity_kind
         AND generation.generation_id = term.generation_id AND generation.active
        WHERE term.entity_kind = 'player'
          AND term.normalized_term >= ${query} COLLATE "C"
          AND term.normalized_term < ${upperBound} COLLATE "C"
      ), winners AS (
        SELECT DISTINCT ON (entity_id) *
        FROM candidates
        ORDER BY entity_id, exact_match DESC, alias_rank, stable_term_rank,
                 normalized_term, display_term
      )
      SELECT entity_id, canonical_name, region, rating, view_count,
             best_legend_name_key, term_kind, display_term
      FROM winners
      ORDER BY exact_match DESC, alias_rank, rating DESC NULLS LAST,
               view_count DESC, entity_id
      LIMIT 40
    `
    return rows.map((row) => ({
      brawlhallaId: row.entity_id,
      name: row.canonical_name,
      region: row.region,
      rating: row.rating,
      viewCount: row.view_count,
      bestLegendNameKey: row.best_legend_name_key,
      matchedAlias: row.term_kind === 'alias' ? row.display_term : null,
    }))
  }

  async function searchClans(rawQuery: string): Promise<ClanSearchHit[]> {
    const query = normalizeDiscoveryTerm(rawQuery)
    if ([...query].length < 2) return []
    const upperBound = `${query}\u{10ffff}`
    const rows = await client<
      Array<{ entity_id: number; canonical_name: string; clan_xp: string; member_count: number }>
    >`
      SELECT term.entity_id, term.canonical_name, term.clan_xp::text, term.member_count
      FROM discovery.terms term
      JOIN discovery.generations generation
        ON generation.entity_kind = term.entity_kind
       AND generation.generation_id = term.generation_id AND generation.active
      WHERE term.entity_kind = 'clan'
        AND term.normalized_term >= ${query} COLLATE "C"
        AND term.normalized_term < ${upperBound} COLLATE "C"
      ORDER BY (term.normalized_term = ${query} COLLATE "C") DESC,
               term.clan_xp DESC, term.entity_id
      LIMIT 5
    `
    return rows.map((row) => ({
      clanId: row.entity_id,
      clanName: row.canonical_name,
      clanXp: row.clan_xp,
      memberCount: row.member_count,
    }))
  }

  async function applyEvents<T extends PlayerProjectionEvent | ClanProjectionEvent>(
    owner: ProjectionOwner,
    events: T[],
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ): Promise<{ appliedEvents: number }> {
    if (events.length === 0 && !operationId) return { appliedEvents: 0 }
    return client.begin(async (transaction) => {
      const sql = transaction as unknown as Sql
      if (operationId) {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery-effect:${operationId}`}, 200))`
        if (authorizeEffect && !(await authorizeEffect())) {
          throw new Error('Discovery effect lease is no longer active')
        }
      }
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery:${owner}`}, 200))`
      const [generation] = await sql<{ generation_id: string; source_version: string | number }[]>`
        SELECT generation_id, source_version
        FROM discovery.generations WHERE entity_kind = ${owner} AND active FOR UPDATE
      `
      const insertedReceipts = await sql<{ event_id: string }[]>`
        INSERT INTO discovery.event_receipts (entity_kind, event_id)
        SELECT ${owner}, event_id
        FROM unnest(${events.map(({ eventId }) => eventId)}::uuid[]) AS receipt(event_id)
        ON CONFLICT DO NOTHING
        RETURNING event_id
      `
      const insertedEventIds = new Set(insertedReceipts.map(({ event_id }) => event_id))
      const snapshotVersion = Number(generation.source_version)
      const processedEventIds = new Set<string>()
      let projectedVersion = snapshotVersion
      for (const event of events) {
        if (!insertedEventIds.has(event.eventId) || processedEventIds.has(event.eventId)) continue
        processedEventIds.add(event.eventId)
        if (event.sourceVersion > snapshotVersion && event.sourceVersion >= projectedVersion) {
          if (owner === 'player') {
            const playerEvent = event as PlayerProjectionEvent
            await replacePlayer(sql, generation.generation_id, playerEvent.fact, playerEvent.brawlhallaId)
          } else {
            const clanEvent = event as ClanProjectionEvent
            await replaceClan(sql, generation.generation_id, clanEvent.fact, clanEvent.clanId)
          }
          projectedVersion = event.sourceVersion
        }
      }
      const appliedEvents = insertedReceipts.length
      await sql`
        UPDATE discovery.generations
        SET source_version = GREATEST(source_version, ${projectedVersion})
        WHERE entity_kind = ${owner} AND generation_id = ${generation.generation_id}
      `
      if (operationId) {
        await sql`
          INSERT INTO discovery.projection_effects (operation_id, entity_kind, source_version)
          VALUES (${operationId}::uuid, ${owner}, ${projectedVersion})
          ON CONFLICT DO NOTHING
        `
      }
      return { appliedEvents }
    })
  }

  async function deliver<T extends PlayerProjectionEvent | ClanProjectionEvent>(
    owner: ProjectionOwner,
    source: PlayerProjectionSource | ClanProjectionSource,
    limit: number,
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ) {
    const events = (await source.pendingEvents(limit)) as T[]
    const result = await applyEvents(owner, events, operationId, authorizeEffect)
    const eventIds = events.map(({ eventId }) => eventId)
    await source.acknowledgeEvents(eventIds)
    if (operationId) {
      await client`
        UPDATE discovery.projection_effects
        SET acknowledged_at = COALESCE(acknowledged_at, clock_timestamp())
        WHERE operation_id = ${operationId}::uuid AND entity_kind = ${owner}
      `
    }
    return { ...result, eventIds }
  }

  async function rebuild(
    owner: ProjectionOwner,
    snapshot: PlayerProjectionSnapshot | ClanProjectionSnapshot,
  ): Promise<void> {
    await client.begin(async (transaction) => {
      const sql = transaction as unknown as Sql
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery:${owner}`}, 200))`
      const [active] = await sql<{ source_version: string | number }[]>`
        SELECT source_version
        FROM discovery.generations WHERE entity_kind = ${owner} AND active FOR UPDATE
      `
      if (Number(active.source_version) > snapshot.sourceVersion) throw new StaleProjectionSnapshotError()
      await replaceGeneration(sql, owner, snapshot)
    })
  }

  async function rebuildFrom(owner: ProjectionOwner, source: PlayerProjectionSource | ClanProjectionSource) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rebuild(owner, await source.snapshot())
        return
      } catch (error) {
        if (!(error instanceof StaleProjectionSnapshotError) || attempt === 2) throw error
      }
    }
  }

  type ComparableTerm = {
    entityId: number
    termKind: string
    displayTerm: string
    normalizedTerm: string
    canonicalName: string
    region: string | null
    rating: number | null
    viewCount: number | null
    bestLegendNameKey: string | null
    clanXp: string | null
    memberCount: number | null
  }

  const compareText = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right))
  const compareTerms = (left: ComparableTerm, right: ComparableTerm) =>
    left.entityId - right.entityId ||
    compareText(left.termKind, right.termKind) ||
    compareText(left.normalizedTerm, right.normalizedTerm) ||
    compareText(left.displayTerm, right.displayTerm)

  type TermGroup = { entityId: number; terms: ComparableTerm[] }
  type ProjectedTermRow = {
    entity_id: number
    term_kind: string
    display_term: string
    normalized_term: string
    canonical_name: string
    region: string | null
    rating: number | null
    view_count: number | null
    best_legend_name_key: string | null
    clan_xp: string | null
    member_count: number | null
  }

  function* expectedTermGroups(
    owner: ProjectionOwner,
    snapshot: PlayerProjectionSnapshot | ClanProjectionSnapshot,
  ): Generator<TermGroup> {
    if (owner === 'player') {
      const facts = [...(snapshot as PlayerProjectionSnapshot).facts].sort(
        (left, right) => left.brawlhallaId - right.brawlhallaId,
      )
      for (const fact of facts) {
        const terms = playerTermsFor(fact)
          .map((term) => ({
            entityId: fact.brawlhallaId,
            termKind: term.kind,
            displayTerm: term.display,
            normalizedTerm: term.normalized,
            canonicalName: fact.name,
            region: fact.region,
            rating: fact.rating,
            viewCount: fact.viewCount,
            bestLegendNameKey: fact.bestLegendNameKey,
            clanXp: null,
            memberCount: null,
          }))
          .sort(compareTerms)
        if (terms.length > 0) yield { entityId: fact.brawlhallaId, terms }
      }
      return
    }
    const facts = [...(snapshot as ClanProjectionSnapshot).facts].sort((left, right) => left.clanId - right.clanId)
    for (const fact of facts) {
      const normalizedTerm = normalizeDiscoveryTerm(fact.clanName)
      if (!normalizedTerm) continue
      yield {
        entityId: fact.clanId,
        terms: [
          {
            entityId: fact.clanId,
            termKind: 'canonical',
            displayTerm: fact.clanName,
            normalizedTerm,
            canonicalName: fact.clanName,
            region: null,
            rating: null,
            viewCount: null,
            bestLegendNameKey: null,
            clanXp: fact.clanXp,
            memberCount: fact.memberCount,
          },
        ],
      }
    }
  }

  const comparableTerm = (row: ProjectedTermRow): ComparableTerm => ({
    entityId: row.entity_id,
    termKind: row.term_kind,
    displayTerm: row.display_term,
    normalizedTerm: row.normalized_term,
    canonicalName: row.canonical_name,
    region: row.region,
    rating: row.rating,
    viewCount: row.view_count,
    bestLegendNameKey: row.best_legend_name_key,
    clanXp: row.clan_xp,
    memberCount: row.member_count,
  })

  async function* projectedTermGroups(sql: Sql, owner: ProjectionOwner): AsyncGenerator<TermGroup> {
    let entityId: number | null = null
    let terms: ComparableTerm[] = []
    const query = sql<ProjectedTermRow[]>`
      SELECT term.entity_id, term.term_kind, term.display_term, term.normalized_term,
             term.canonical_name, term.region, term.rating, term.view_count,
             term.best_legend_name_key, term.clan_xp::text, term.member_count
      FROM discovery.terms term
      JOIN discovery.generations generation
        ON generation.entity_kind = term.entity_kind
       AND generation.generation_id = term.generation_id AND generation.active
      WHERE term.entity_kind = ${owner}
      ORDER BY term.entity_id, term.term_kind COLLATE "C", term.normalized_term COLLATE "C",
               term.display_term COLLATE "C"
    `
    for await (const rows of query.cursor(1_000)) {
      for (const row of rows) {
        if (entityId !== null && row.entity_id !== entityId) {
          yield { entityId, terms }
          terms = []
        }
        entityId = row.entity_id
        terms.push(comparableTerm(row))
      }
    }
    if (entityId !== null) yield { entityId, terms }
  }

  function termHasher() {
    const hash = createHash('sha256')
    let first = true
    hash.update('[')
    return {
      update(terms: ComparableTerm[]) {
        for (const term of terms) {
          if (!first) hash.update(',')
          hash.update(JSON.stringify(term))
          first = false
        }
      },
      digest: () => hash.update(']').digest('hex'),
    }
  }

  const sameTerms = (left: ComparableTerm[], right: ComparableTerm[]) =>
    left.length === right.length && left.every((term, index) => JSON.stringify(term) === JSON.stringify(right[index]))

  async function compareProjection(
    sql: Sql,
    owner: ProjectionOwner,
    snapshot: PlayerProjectionSnapshot | ClanProjectionSnapshot,
  ) {
    const expected = expectedTermGroups(owner, snapshot)[Symbol.iterator]()
    const projected = projectedTermGroups(sql, owner)[Symbol.asyncIterator]()
    const expectedHash = termHasher()
    const projectedHash = termHasher()
    const details: Array<
      ReconciliationDifference & { expected: ComparableTerm[] | null; projected: ComparableTerm[] | null }
    > = []
    let differenceCount = 0
    let projectedCount = 0
    let expectedGroup = expected.next()
    let projectedGroup = await projected.next()
    while (!expectedGroup.done || !projectedGroup.done) {
      const expectedId = expectedGroup.done ? null : expectedGroup.value.entityId
      const projectedId = projectedGroup.done ? null : projectedGroup.value.entityId
      const entityId =
        expectedId === null
          ? (projectedId as number)
          : projectedId === null
            ? expectedId
            : Math.min(expectedId, projectedId)
      const expectedTerms = expectedId === entityId ? expectedGroup.value.terms : null
      const projectedTerms = projectedId === entityId ? projectedGroup.value.terms : null
      if (expectedTerms) {
        expectedHash.update(expectedTerms)
        expectedGroup = expected.next()
      }
      if (projectedTerms) {
        projectedHash.update(projectedTerms)
        projectedCount++
        projectedGroup = await projected.next()
      }
      if (expectedTerms && projectedTerms && sameTerms(expectedTerms, projectedTerms)) continue
      differenceCount++
      if (details.length === maxPersistedReconciliationDifferences) continue
      details.push({
        entityId,
        kind: expectedTerms ? (projectedTerms ? 'mismatched' : 'missing') : 'unexpected',
        expected: expectedTerms,
        projected: projectedTerms,
      })
    }
    return {
      expectedHash: expectedHash.digest(),
      projectedHash: projectedHash.digest(),
      projectedCount,
      differenceCount,
      details,
    }
  }

  async function projectionEvidence(sql: Sql, owner: ProjectionOwner) {
    const hash = termHasher()
    let projectedCount = 0
    for await (const group of projectedTermGroups(sql, owner)) {
      hash.update(group.terms)
      projectedCount++
    }
    return { hash: hash.digest(), projectedCount }
  }

  async function existingReconciliation(sql: Sql, operationId: string): Promise<ReconciliationResult | null> {
    const [run] = await sql<
      Array<{
        run_id: string
        entity_kind: ProjectionOwner
        observed_source_version: string | number
        pending_event_count: number
        oldest_pending_at: Date | null
        expected_hash: string
        projected_hash_before: string
        projected_hash_after: string
        exact_before: boolean
        exact_after: boolean
        repaired: boolean
        difference_count: number
        difference_details_truncated: boolean
      }>
    >`
      SELECT run_id, entity_kind, observed_source_version, pending_event_count, oldest_pending_at,
             expected_hash, projected_hash_before, projected_hash_after,
             exact_before, exact_after, repaired, difference_count, difference_details_truncated
      FROM discovery.reconciliation_runs WHERE operation_id = ${operationId}::uuid
    `
    if (!run) return null
    const differences = await sql<{ entity_id: number; difference_kind: ReconciliationDifference['kind'] }[]>`
      SELECT entity_id, difference_kind FROM discovery.reconciliation_differences
      WHERE run_id = ${run.run_id} ORDER BY entity_id
    `
    return {
      runId: run.run_id,
      owner: run.entity_kind,
      observedSourceVersion: Number(run.observed_source_version),
      pendingEventCount: run.pending_event_count,
      oldestPendingAt: run.oldest_pending_at,
      expectedHash: run.expected_hash,
      projectedHashBefore: run.projected_hash_before,
      projectedHashAfter: run.projected_hash_after,
      exactBefore: run.exact_before,
      exactAfter: run.exact_after,
      repaired: run.repaired,
      differenceCount: run.difference_count,
      differenceDetailsTruncated: run.difference_details_truncated,
      differences: differences.map((difference) => ({
        entityId: difference.entity_id,
        kind: difference.difference_kind,
      })),
    }
  }

  async function reconcile(
    owner: ProjectionOwner,
    source: PlayerProjectionSource | ClanProjectionSource,
    operationId?: string,
    authorizeEffect?: () => Promise<boolean>,
  ): Promise<ReconciliationResult> {
    if (operationId) {
      const existing = await existingReconciliation(client, operationId)
      if (existing) return existing
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      let snapshot: PlayerProjectionSnapshot | ClanProjectionSnapshot | null = await source.snapshot()
      const observedSourceVersion = snapshot.sourceVersion
      const pendingEventCount = snapshot.pendingEventCount ?? 0
      const oldestPendingAt = snapshot.oldestPendingAt ?? null
      const sourceFactCount = snapshot.facts.length
      const comparisonSnapshot = snapshot
      try {
        return await client.begin(async (transaction) => {
          const sql = transaction as unknown as Sql
          if (operationId) {
            await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery-effect:${operationId}`}, 200))`
            if (authorizeEffect && !(await authorizeEffect())) {
              throw new Error('Discovery effect lease is no longer active')
            }
          }
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery:${owner}`}, 200))`
          if (operationId) {
            const existing = await existingReconciliation(sql, operationId)
            if (existing) return existing
          }
          const [active] = await sql<{ generation_id: string; source_version: string | number }[]>`
            SELECT generation_id, source_version FROM discovery.generations
            WHERE entity_kind = ${owner} AND active FOR UPDATE
          `
          if (Number(active.source_version) > observedSourceVersion) throw new StaleProjectionSnapshotError()

          const differences = await compareProjection(sql, owner, comparisonSnapshot)
          const exactBefore = differences.differenceCount === 0
          const expectedHash = differences.expectedHash
          const projectedHashBefore = differences.projectedHash
          const projectedBeforeCount = differences.projectedCount
          let projectedHashAfter = projectedHashBefore
          let projectedAfterCount = projectedBeforeCount
          if (!exactBefore) {
            const repairSnapshot = await source.snapshot()
            if (repairSnapshot.sourceVersion !== observedSourceVersion) throw new StaleProjectionSnapshotError()
            await replaceGeneration(sql, owner, repairSnapshot)
            const repaired = await compareProjection(sql, owner, repairSnapshot)
            if (repaired.differenceCount > 0)
              throw new Error('Discovery reconciliation repair did not converge exactly')
            projectedHashAfter = repaired.projectedHash
            projectedAfterCount = repaired.projectedCount
          }
          snapshot = null
          const [run] = await sql<{ run_id: string }[]>`
            INSERT INTO discovery.reconciliation_runs
              (operation_id, entity_kind, observed_source_version,
               projected_version_before, projected_version_after,
               source_fact_count, projected_fact_count_before, projected_fact_count_after,
               pending_event_count, oldest_pending_at,
               expected_hash, projected_hash_before, projected_hash_after,
               exact_before, exact_after, repaired, difference_count, difference_details_truncated)
            VALUES
              (${operationId ?? null}::uuid, ${owner}, ${observedSourceVersion},
               ${Number(active.source_version)}, ${exactBefore ? Number(active.source_version) : observedSourceVersion},
               ${sourceFactCount}, ${projectedBeforeCount}, ${projectedAfterCount},
               ${pendingEventCount}, ${oldestPendingAt},
               ${expectedHash}, ${projectedHashBefore}, ${projectedHashAfter},
               ${exactBefore}, ${true}, ${!exactBefore}, ${differences.differenceCount},
               ${differences.differenceCount > maxPersistedReconciliationDifferences})
            RETURNING run_id
          `
          for (const difference of differences.details) {
            await sql`
              INSERT INTO discovery.reconciliation_differences
                (run_id, entity_id, difference_kind, expected_fact, projected_fact)
              VALUES
                (${run.run_id}, ${difference.entityId}, ${difference.kind},
                 ${difference.expected ? sql.json(difference.expected) : null},
                 ${difference.projected ? sql.json(difference.projected) : null})
            `
          }
          return {
            runId: run.run_id,
            owner,
            observedSourceVersion,
            pendingEventCount,
            oldestPendingAt,
            expectedHash,
            projectedHashBefore,
            projectedHashAfter,
            exactBefore,
            exactAfter: true,
            repaired: !exactBefore,
            differenceCount: differences.differenceCount,
            differenceDetailsTruncated: differences.differenceCount > maxPersistedReconciliationDifferences,
            differences: differences.details.map(({ entityId, kind }) => ({ entityId, kind })),
          }
        })
      } catch (error) {
        if (!(error instanceof StaleProjectionSnapshotError) || attempt === 2) throw error
      }
    }
    throw new Error('Discovery reconciliation exhausted retries')
  }

  async function existingMigrationEvidence(sql: Sql, operationKey: string): Promise<MigrationEvidenceResult | null> {
    const [run] = await sql<
      Array<{
        run_id: string
        operation_key: string
        input_hash: string
        status: 'passed' | 'blocked'
        source_evidence_hash: string
        player_projection_hash: string
        clan_projection_hash: string
        fixture_hash: string
        fixture_count: number
        intentional_difference_count: number
        unexplained_mismatch_count: number
        mismatch_detail_count: number
        mismatch_details_truncated: boolean
        mismatch_details: SemanticMigrationMismatch[]
      }>
    >`
      SELECT run_id, operation_key, input_hash, status, source_evidence_hash,
             player_projection_hash, clan_projection_hash, fixture_hash, fixture_count,
             intentional_difference_count, unexplained_mismatch_count,
             mismatch_detail_count, mismatch_details_truncated, mismatch_details
      FROM discovery.semantic_migration_runs WHERE operation_key = ${operationKey}
    `
    if (!run) return null
    return {
      runId: run.run_id,
      operationKey: run.operation_key,
      inputHash: run.input_hash.trim(),
      sourceEvidenceHash: run.source_evidence_hash.trim(),
      status: run.status,
      playerProjectionHash: run.player_projection_hash.trim(),
      clanProjectionHash: run.clan_projection_hash.trim(),
      fixtureHash: run.fixture_hash.trim(),
      fixtureCount: run.fixture_count,
      intentionalDifferenceCount: run.intentional_difference_count,
      unexplainedMismatchCount: run.unexplained_mismatch_count,
      mismatchDetailCount: run.mismatch_detail_count,
      mismatchDetailsTruncated: run.mismatch_details_truncated,
      mismatches: run.mismatch_details,
    }
  }

  async function assertStoredReconciliationEvidence(sql: Sql, input: MigrationEvidenceInput): Promise<void> {
    const rows = await sql<
      Array<{
        run_id: string
        entity_kind: ProjectionOwner
        observed_source_version: string | number
        pending_event_count: number
        expected_hash: string
        projected_hash_after: string
        exact_after: boolean
      }>
    >`
      SELECT run_id, entity_kind, observed_source_version, pending_event_count,
             expected_hash, projected_hash_after, exact_after
      FROM discovery.reconciliation_runs
      WHERE run_id IN (${input.playerReconciliation.runId}::uuid, ${input.clanReconciliation.runId}::uuid)
    `
    const matches = (reconciliation: ReconciliationResult) => {
      const stored = rows.find(({ run_id }) => run_id === reconciliation.runId)
      return (
        stored?.entity_kind === reconciliation.owner &&
        Number(stored.observed_source_version) === reconciliation.observedSourceVersion &&
        stored.pending_event_count === reconciliation.pendingEventCount &&
        stored.expected_hash.trim() === reconciliation.expectedHash &&
        stored.projected_hash_after.trim() === reconciliation.projectedHashAfter &&
        stored.exact_after === reconciliation.exactAfter
      )
    }
    if (!matches(input.playerReconciliation) || !matches(input.clanReconciliation)) {
      throw new Error('Discovery migration evidence does not match stored reconciliation')
    }
  }

  async function assertCurrentProjectionEvidence(sql: Sql, input: MigrationEvidenceInput): Promise<void> {
    const reconciliations = [input.playerReconciliation, input.clanReconciliation]
    for (const reconciliation of reconciliations) {
      const [generation] = await sql<{ source_version: string | number }[]>`
        SELECT source_version FROM discovery.generations
        WHERE entity_kind = ${reconciliation.owner} AND active FOR UPDATE
      `
      const current = await projectionEvidence(sql, reconciliation.owner)
      if (
        Number(generation?.source_version) !== reconciliation.observedSourceVersion ||
        current.hash !== reconciliation.expectedHash
      ) {
        throw new Error('Discovery migration evidence does not match the active projection')
      }
    }
  }

  async function commitMigrationEvidence(
    input: MigrationEvidenceInput,
    authorizeEvidence?: () => Promise<boolean>,
  ): Promise<MigrationEvidenceResult> {
    if (!input.operationKey || input.operationKey.length > 256) {
      throw new Error('Discovery migration operation key must be between 1 and 256 characters')
    }
    if (!/^[a-f0-9]{64}$/u.test(input.sourceEvidenceHash)) {
      throw new Error('Discovery migration source evidence hash must be SHA-256')
    }
    if (
      input.playerReconciliation.owner !== 'player' ||
      input.clanReconciliation.owner !== 'clan' ||
      !input.playerReconciliation.exactAfter ||
      !input.clanReconciliation.exactAfter ||
      input.playerReconciliation.projectedHashAfter !== input.playerReconciliation.expectedHash ||
      input.clanReconciliation.projectedHashAfter !== input.clanReconciliation.expectedHash
    ) {
      throw new Error('Discovery migration evidence requires exact owner reconciliation')
    }
    if (
      input.pendingPlayerEvents !== 0 ||
      input.pendingClanEvents !== 0 ||
      input.playerReconciliation.pendingEventCount !== 0 ||
      input.clanReconciliation.pendingEventCount !== 0
    ) {
      throw new Error('Discovery migration evidence requires zero owner lag')
    }
    const { orderedFixtures, serializedManifest } = validateAndOrderSemanticFixtures(input.fixtures)
    const fixtureHash = semanticHash(serializedManifest)
    const inputHash = semanticHash(
      stableJson({
        operationKey: input.operationKey,
        sourceEvidenceHash: input.sourceEvidenceHash,
        player: {
          sourceVersion: input.playerReconciliation.observedSourceVersion,
          expectedHash: input.playerReconciliation.expectedHash,
          projectedHashAfter: input.playerReconciliation.projectedHashAfter,
          pendingEventCount: input.playerReconciliation.pendingEventCount,
        },
        clan: {
          sourceVersion: input.clanReconciliation.observedSourceVersion,
          expectedHash: input.clanReconciliation.expectedHash,
          projectedHashAfter: input.clanReconciliation.projectedHashAfter,
          pendingEventCount: input.clanReconciliation.pendingEventCount,
        },
        pendingPlayerEvents: input.pendingPlayerEvents,
        pendingClanEvents: input.pendingClanEvents,
        fixtureHash,
      }),
    )
    const classified = classifySemanticFixtures(orderedFixtures)
    const persistedMismatches = classified.mismatches.slice(0, maxPersistedSemanticMigrationMismatches)
    return client.begin(async (transaction) => {
      const sql = transaction as unknown as Sql
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery-migration:${input.operationKey}`}, 225))`
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('discovery:player', 200))`
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('discovery:clan', 200))`
      await assertStoredReconciliationEvidence(sql, input)
      await assertCurrentProjectionEvidence(sql, input)
      if (authorizeEvidence && !(await authorizeEvidence())) {
        throw new Error('Discovery owner facts changed before evidence commit')
      }
      const existing = await existingMigrationEvidence(sql, input.operationKey)
      if (existing) {
        if (existing.inputHash !== inputHash) {
          throw new Error('Discovery migration operation key was already used for different evidence')
        }
        return existing
      }
      const status = classified.mismatches.length === 0 ? ('passed' as const) : ('blocked' as const)
      await sql`
        INSERT INTO discovery.semantic_migration_runs
          (operation_key, input_hash, source_evidence_hash, status,
           player_reconciliation_run_id, clan_reconciliation_run_id, player_source_version,
           clan_source_version, player_projection_hash, clan_projection_hash,
           fixture_hash, fixture_count, fixture_manifest, intentional_difference_count,
           unexplained_mismatch_count, mismatch_detail_count, mismatch_details_truncated, mismatch_details)
        VALUES
          (${input.operationKey}, ${inputHash}, ${input.sourceEvidenceHash}, ${status},
           ${input.playerReconciliation.runId}::uuid, ${input.clanReconciliation.runId}::uuid,
           ${input.playerReconciliation.observedSourceVersion},
           ${input.clanReconciliation.observedSourceVersion}, ${input.playerReconciliation.projectedHashAfter},
           ${input.clanReconciliation.projectedHashAfter}, ${fixtureHash}, ${orderedFixtures.length},
           ${sql.json(orderedFixtures as never)}, ${classified.intentionalDifferenceCount},
           ${classified.mismatches.length},
           ${persistedMismatches.length},
           ${classified.mismatches.length > maxPersistedSemanticMigrationMismatches},
           ${sql.json(persistedMismatches as never)})
      `
      const result = await existingMigrationEvidence(sql, input.operationKey)
      if (!result) throw new Error('Discovery migration evidence disappeared after commit')
      return result
    })
  }

  async function reconciliationDue(owner: ProjectionOwner, intervalMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
      throw new Error('Discovery reconciliation interval must be a positive safe integer')
    }
    const [result] = await client<{ due: boolean }[]>`
      SELECT NOT EXISTS (
        SELECT 1 FROM discovery.reconciliation_runs
        WHERE entity_kind = ${owner}
          AND completed_at > clock_timestamp() - (${intervalMs} * interval '1 millisecond')
      ) AS due
    `
    return result.due
  }

  async function reconciliationEffectApplied(operationId: string): Promise<boolean> {
    const [result] = await client<{ applied: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM discovery.reconciliation_runs WHERE operation_id = ${operationId}::uuid
      ) AS applied
    `
    return result.applied
  }

  async function projectionEffectState(owner: ProjectionOwner, operationId: string) {
    const [effect] = await client<{ acknowledged_at: Date | null }[]>`
      SELECT acknowledged_at
      FROM discovery.projection_effects
      WHERE operation_id = ${operationId}::uuid AND entity_kind = ${owner}
    `
    if (!effect) return 'none' as const
    return effect.acknowledged_at ? ('acknowledged' as const) : ('applied' as const)
  }

  return {
    async search(rawQuery) {
      const query = normalizeDiscoveryTerm(rawQuery)
      if ([...query].length < 2) return { players: [], clans: [] }
      const [players, clans] = await Promise.all([searchPlayers(query), searchClans(query)])
      return { players, clans }
    },
    applyPlayerEvents: (events, operationId, authorizeEffect) =>
      applyEvents('player', events, operationId, authorizeEffect),
    applyClanEvents: (events, operationId, authorizeEffect) =>
      applyEvents('clan', events, operationId, authorizeEffect),
    deliverPendingPlayers: (source, limit, operationId, authorizeEffect) =>
      deliver<PlayerProjectionEvent>('player', source, limit, operationId, authorizeEffect),
    deliverPendingClans: (source, limit, operationId, authorizeEffect) =>
      deliver<ClanProjectionEvent>('clan', source, limit, operationId, authorizeEffect),
    rebuildPlayers: (snapshot) => rebuild('player', snapshot),
    rebuildClans: (snapshot) => rebuild('clan', snapshot),
    rebuildPlayersFrom: (source) => rebuildFrom('player', source),
    rebuildClansFrom: (source) => rebuildFrom('clan', source),
    reconcilePlayers: (source, operationId, authorizeEffect) =>
      reconcile('player', source, operationId, authorizeEffect),
    reconcileClans: (source, operationId, authorizeEffect) => reconcile('clan', source, operationId, authorizeEffect),
    reconciliationDue,
    reconciliationEffectApplied,
    playerProjectionEffectState: (operationId) => projectionEffectState('player', operationId),
    clanProjectionEffectState: (operationId) => projectionEffectState('clan', operationId),
    commitMigrationEvidence,
    close: () => client.end(),
  }
}

export type PostgresDiscovery = ReturnType<typeof createPostgresDiscovery>
