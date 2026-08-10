import { createHash } from 'node:crypto'
import postgres from 'postgres'
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
  type ProjectionOwner,
  type ReconciliationDifference,
  type ReconciliationResult,
  normalizeDiscoveryTerm,
} from './index'

type Sql = ReturnType<typeof postgres>
type PlayerTerm = { kind: 'canonical' | 'segment' | 'alias'; display: string; normalized: string }

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

async function replacePlayer(sql: Sql, generationId: string, fact: PlayerDiscoveryFact | null, brawlhallaId: number) {
  await sql`
    DELETE FROM discovery.terms
    WHERE entity_kind = 'player' AND generation_id = ${generationId} AND entity_id = ${brawlhallaId}
  `
  if (!fact) return
  const terms = playerTermsFor(fact)
  if (terms.length === 0) return
  await sql`
    INSERT INTO discovery.terms ${sql(
      terms.map((term) => ({
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
      })),
    )}
  `
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
    for (const fact of [...(snapshot as PlayerProjectionSnapshot).facts].sort(
      (left, right) => left.brawlhallaId - right.brawlhallaId,
    )) {
      await replacePlayer(sql, generation.generation_id, fact, fact.brawlhallaId)
    }
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
      let appliedEvents = 0
      let projectedVersion = Number(generation.source_version)
      for (const event of events) {
        const inserted = await sql<{ event_id: string }[]>`
          INSERT INTO discovery.event_receipts (entity_kind, event_id)
          VALUES (${owner}, ${event.eventId})
          ON CONFLICT DO NOTHING
          RETURNING event_id
        `
        if (!inserted[0]) continue
        if (event.sourceVersion >= projectedVersion) {
          if (owner === 'player') {
            const playerEvent = event as PlayerProjectionEvent
            await replacePlayer(sql, generation.generation_id, playerEvent.fact, playerEvent.brawlhallaId)
          } else {
            const clanEvent = event as ClanProjectionEvent
            await replaceClan(sql, generation.generation_id, clanEvent.fact, clanEvent.clanId)
          }
          projectedVersion = event.sourceVersion
        }
        appliedEvents++
      }
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

  function expectedTerms(
    owner: ProjectionOwner,
    snapshot: PlayerProjectionSnapshot | ClanProjectionSnapshot,
  ): ComparableTerm[] {
    const terms =
      owner === 'player'
        ? (snapshot as PlayerProjectionSnapshot).facts.flatMap((fact) =>
            playerTermsFor(fact).map((term) => ({
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
            })),
          )
        : (snapshot as ClanProjectionSnapshot).facts.flatMap((fact) => {
            const normalizedTerm = normalizeDiscoveryTerm(fact.clanName)
            return normalizedTerm
              ? [
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
                ]
              : []
          })
    return terms.sort(compareTerms)
  }

  async function projectedTerms(sql: Sql, owner: ProjectionOwner): Promise<ComparableTerm[]> {
    const rows = await sql<
      Array<{
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
      }>
    >`
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
    return rows.map((row) => ({
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
    }))
  }

  const termHash = (terms: ComparableTerm[]) => createHash('sha256').update(JSON.stringify(terms)).digest('hex')

  function groupedTerms(terms: ComparableTerm[]): Map<number, ComparableTerm[]> {
    const grouped = new Map<number, ComparableTerm[]>()
    for (const term of terms) {
      const entityTerms = grouped.get(term.entityId) ?? []
      entityTerms.push(term)
      grouped.set(term.entityId, entityTerms)
    }
    return grouped
  }

  function reconciliationDifferences(
    expected: ComparableTerm[],
    projected: ComparableTerm[],
  ): Array<ReconciliationDifference & { expected: ComparableTerm[] | null; projected: ComparableTerm[] | null }> {
    const expectedById = groupedTerms(expected)
    const projectedById = groupedTerms(projected)
    return [...new Set([...expectedById.keys(), ...projectedById.keys()])]
      .sort((left, right) => left - right)
      .flatMap((entityId) => {
        const expectedFact = expectedById.get(entityId) ?? null
        const projectedFact = projectedById.get(entityId) ?? null
        if (JSON.stringify(expectedFact) === JSON.stringify(projectedFact)) return []
        return [
          {
            entityId,
            kind: expectedFact
              ? projectedFact
                ? ('mismatched' as const)
                : ('missing' as const)
              : ('unexpected' as const),
            expected: expectedFact,
            projected: projectedFact,
          },
        ]
      })
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
      const snapshot = await source.snapshot()
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
          if (Number(active.source_version) > snapshot.sourceVersion) throw new StaleProjectionSnapshotError()

          const expected = expectedTerms(owner, snapshot)
          const projectedBefore = await projectedTerms(sql, owner)
          const differences = reconciliationDifferences(expected, projectedBefore)
          const exactBefore = differences.length === 0
          if (!exactBefore) await replaceGeneration(sql, owner, snapshot)

          const projectedAfter = await projectedTerms(sql, owner)
          const exactAfter = JSON.stringify(expected) === JSON.stringify(projectedAfter)
          if (!exactAfter) throw new Error('Discovery reconciliation repair did not converge exactly')
          const expectedHash = termHash(expected)
          const projectedHashBefore = termHash(projectedBefore)
          const projectedHashAfter = termHash(projectedAfter)
          const projectedBeforeCount = new Set(projectedBefore.map(({ entityId }) => entityId)).size
          const projectedAfterCount = new Set(projectedAfter.map(({ entityId }) => entityId)).size
          const [run] = await sql<{ run_id: string }[]>`
            INSERT INTO discovery.reconciliation_runs
              (operation_id, entity_kind, observed_source_version,
               projected_version_before, projected_version_after,
               source_fact_count, projected_fact_count_before, projected_fact_count_after,
               pending_event_count, oldest_pending_at,
               expected_hash, projected_hash_before, projected_hash_after,
               exact_before, exact_after, repaired, difference_count, difference_details_truncated)
            VALUES
              (${operationId ?? null}::uuid, ${owner}, ${snapshot.sourceVersion},
               ${Number(active.source_version)}, ${exactBefore ? Number(active.source_version) : snapshot.sourceVersion},
               ${snapshot.facts.length}, ${projectedBeforeCount}, ${projectedAfterCount},
               ${snapshot.pendingEventCount ?? 0}, ${snapshot.oldestPendingAt ?? null},
               ${expectedHash}, ${projectedHashBefore}, ${projectedHashAfter},
               ${exactBefore}, ${exactAfter}, ${!exactBefore}, ${differences.length},
               ${differences.length > maxPersistedReconciliationDifferences})
            RETURNING run_id
          `
          for (const difference of differences.slice(0, maxPersistedReconciliationDifferences)) {
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
            observedSourceVersion: snapshot.sourceVersion,
            pendingEventCount: snapshot.pendingEventCount ?? 0,
            oldestPendingAt: snapshot.oldestPendingAt ?? null,
            expectedHash,
            projectedHashBefore,
            projectedHashAfter,
            exactBefore,
            exactAfter,
            repaired: !exactBefore,
            differenceCount: differences.length,
            differenceDetailsTruncated: differences.length > maxPersistedReconciliationDifferences,
            differences: differences
              .slice(0, maxPersistedReconciliationDifferences)
              .map(({ entityId, kind }) => ({ entityId, kind })),
          }
        })
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
    playerProjectionEffectState: (operationId) => projectionEffectState('player', operationId),
    clanProjectionEffectState: (operationId) => projectionEffectState('clan', operationId),
    close: () => client.end(),
  }
}

export type PostgresDiscovery = ReturnType<typeof createPostgresDiscovery>
