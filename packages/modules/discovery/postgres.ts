import { createHash } from 'node:crypto'
import type { Database, Sql } from '@brawltome/foundation'
import {
  type ClanDiscoveryFact,
  type ClanProjectionEvent,
  type ClanProjectionSnapshot,
  type ClanProjectionSource,
  type ClanSearchHit,
  type DiscoveryQueries,
  type PlayerDiscoveryFact,
  type PlayerProjectionEvent,
  type PlayerProjectionSnapshot,
  type PlayerProjectionSource,
  type PlayerSearchHit,
  type PlayerSearchTerm,
  type ProjectionOwner,
  type ProjectionSnapshotStream,
  type ReconciliationDifference,
  type ReconciliationResult,
  normalizeDiscoveryTerm,
  playerSearchTerms,
} from './model'

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

type ReconciliationSnapshot = ProjectionSnapshotStream<PlayerDiscoveryFact | ClanDiscoveryFact>

class StaleProjectionSnapshotError extends Error {}

function playerTermRows(generationId: string, fact: PlayerDiscoveryFact): TermRow[] {
  return playerSearchTerms(fact).map((term) => ({
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

async function replaceGenerationFromStream(
  sql: Sql,
  owner: ProjectionOwner,
  snapshot: ReconciliationSnapshot,
): Promise<void> {
  const [generation] = await sql<{ generation_id: string }[]>`
    INSERT INTO discovery.generations (entity_kind, source_version)
    VALUES (${owner}, ${snapshot.sourceVersion}) RETURNING generation_id
  `

  if (owner === 'player') {
    const rows: TermRow[] = []

    for await (const fact of snapshot.facts()) {
      for (const row of playerTermRows(generation.generation_id, fact as PlayerDiscoveryFact)) {
        rows.push(row)
        if (rows.length === termInsertBatchSize) {
          await sql`INSERT INTO discovery.terms ${sql(rows)}`
          rows.length = 0
        }
      }
    }

    if (rows.length > 0) await sql`INSERT INTO discovery.terms ${sql(rows)}`
  } else {
    for await (const fact of snapshot.facts()) {
      const clan = fact as ClanDiscoveryFact

      await replaceClan(sql, generation.generation_id, clan, clan.clanId)
    }
  }

  await sql`UPDATE discovery.generations SET active = false WHERE entity_kind = ${owner} AND active`

  await sql`
    UPDATE discovery.generations SET active = true
    WHERE entity_kind = ${owner} AND generation_id = ${generation.generation_id}
  `

  await sql`DELETE FROM discovery.generations WHERE entity_kind = ${owner} AND NOT active`
}

function eagerSnapshot(
  owner: ProjectionOwner,
  snapshot: PlayerProjectionSnapshot | ClanProjectionSnapshot,
): ReconciliationSnapshot {
  const facts =
    owner === 'player'
      ? [...(snapshot as PlayerProjectionSnapshot).facts].sort((left, right) => left.brawlhallaId - right.brawlhallaId)
      : [...(snapshot as ClanProjectionSnapshot).facts].sort((left, right) => left.clanId - right.clanId)

  return {
    sourceVersion: snapshot.sourceVersion,
    pendingEventCount: snapshot.pendingEventCount ?? 0,
    oldestPendingAt: snapshot.oldestPendingAt ?? null,
    facts: async function* () {
      for (const fact of facts) yield fact
    },
  }
}

async function replaceGeneration(
  sql: Sql,
  owner: ProjectionOwner,
  snapshot: PlayerProjectionSnapshot | ClanProjectionSnapshot,
): Promise<void> {
  await replaceGenerationFromStream(sql, owner, eagerSnapshot(owner, snapshot))
}

export function createPostgresDiscovery(database: Database): DiscoveryQueries & {
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
  projectionEffectState(owner: ProjectionOwner, operationId: string): Promise<'none' | 'applied' | 'acknowledged'>
  playerProjectionEffectState(operationId: string): Promise<'none' | 'applied' | 'acknowledged'>
  clanProjectionEffectState(operationId: string): Promise<'none' | 'applied' | 'acknowledged'>
} {
  const client = database.sql

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
        term_kind: PlayerSearchTerm['kind']
        display_term: string
      }>
    >`
      WITH candidates AS (
        SELECT term.*,
               term.normalized_term = ${query} COLLATE "C" AND term.term_kind <> 'word' AS exact_match,
               CASE WHEN term.term_kind = 'word' THEN 1 ELSE 0 END AS word_rank,
               CASE WHEN term.term_kind = 'alias' THEN 1 ELSE 0 END AS alias_rank,
               CASE term.term_kind WHEN 'canonical' THEN 0 WHEN 'segment' THEN 1 WHEN 'alias' THEN 2 ELSE 3 END
                 AS stable_term_rank
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
        ORDER BY entity_id, exact_match DESC, word_rank, alias_rank, stable_term_rank,
                 normalized_term, display_term
      )
      SELECT entity_id, canonical_name, region, rating, view_count,
             best_legend_name_key, term_kind, display_term
      FROM winners
      -- A word inside a name ranks below every name and alias match, so "alpha" lists "Alpha" before "Alpha Two".
      ORDER BY exact_match DESC, word_rank, alias_rank, (rating IS NULL),
               (best_legend_name_key IS NULL), rating DESC NULLS LAST, view_count DESC, entity_id
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
        // Events carry the source version their fact was read at. A bulk write enqueues many events under one version
        // and delivery splits them into batches, so an event at the version the generation already reached still holds
        // a current fact; only strictly older facts are stale.
        if (event.sourceVersion >= snapshotVersion && event.sourceVersion >= projectedVersion) {
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

  async function* expectedTermGroups(
    owner: ProjectionOwner,
    snapshot: ReconciliationSnapshot,
    onFact: () => void,
  ): AsyncGenerator<TermGroup> {
    let priorEntityId = 0

    if (owner === 'player') {
      for await (const value of snapshot.facts()) {
        onFact()
        const fact = value as PlayerDiscoveryFact

        if (fact.brawlhallaId <= priorEntityId) throw new Error('Player reconciliation stream must be strictly ordered')

        priorEntityId = fact.brawlhallaId

        const terms = playerSearchTerms(fact)
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

    for await (const value of snapshot.facts()) {
      onFact()
      const fact = value as ClanDiscoveryFact

      if (fact.clanId <= priorEntityId) throw new Error('Clan reconciliation stream must be strictly ordered')

      priorEntityId = fact.clanId
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

  async function compareProjection(sql: Sql, owner: ProjectionOwner, snapshot: ReconciliationSnapshot) {
    let sourceFactCount = 0
    const expected = expectedTermGroups(owner, snapshot, () => sourceFactCount++)[Symbol.asyncIterator]()
    const projected = projectedTermGroups(sql, owner)[Symbol.asyncIterator]()
    const expectedHash = termHasher()
    const projectedHash = termHasher()

    const details: Array<
      ReconciliationDifference & { expected: ComparableTerm[] | null; projected: ComparableTerm[] | null }
    > = []

    let differenceCount = 0
    let projectedCount = 0
    let expectedGroup = await expected.next()
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
        expectedGroup = await expected.next()
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
      sourceFactCount,
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
      try {
        const reconcileSnapshot = async (snapshot: ReconciliationSnapshot, streamed: boolean) => {
          const observedSourceVersion = snapshot.sourceVersion
          const pendingEventCount = snapshot.pendingEventCount
          const oldestPendingAt = snapshot.oldestPendingAt

          return client.begin(async (transaction) => {
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

            const differences = await compareProjection(sql, owner, snapshot)
            const sourceFactCount = differences.sourceFactCount
            const exactBefore = differences.differenceCount === 0
            const expectedHash = differences.expectedHash
            const projectedHashBefore = differences.projectedHash
            const projectedBeforeCount = differences.projectedCount
            let projectedHashAfter = projectedHashBefore
            let projectedAfterCount = projectedBeforeCount

            if (!exactBefore) {
              const repairSnapshot = streamed ? snapshot : eagerSnapshot(owner, await source.snapshot())

              if (repairSnapshot.sourceVersion !== observedSourceVersion) throw new StaleProjectionSnapshotError()

              await replaceGenerationFromStream(sql, owner, repairSnapshot)
              const repaired = await compareProjection(sql, owner, repairSnapshot)

              if (repaired.differenceCount > 0)
                throw new Error('Discovery reconciliation repair did not converge exactly')

              projectedHashAfter = repaired.projectedHash
              projectedAfterCount = repaired.projectedCount
            }

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
        }

        const playerSource = owner === 'player' ? (source as PlayerProjectionSource) : null

        if (playerSource?.withSnapshot) {
          return await playerSource.withSnapshot((snapshot) => reconcileSnapshot(snapshot, true))
        }

        return await reconcileSnapshot(eagerSnapshot(owner, await source.snapshot()), false)
      } catch (error) {
        if (!(error instanceof StaleProjectionSnapshotError) || attempt === 2) throw error
      }
    }

    throw new Error('Discovery reconciliation exhausted retries')
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
    projectionEffectState,
    playerProjectionEffectState: (operationId) => projectionEffectState('player', operationId),
    clanProjectionEffectState: (operationId) => projectionEffectState('clan', operationId),
  }
}

export type PostgresDiscovery = ReturnType<typeof createPostgresDiscovery>
