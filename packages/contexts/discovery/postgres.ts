import postgres from 'postgres'
import {
  type DiscoveryQueries,
  type PlayerDiscoveryFact,
  type PlayerProjectionEvent,
  type PlayerProjectionSnapshot,
  type PlayerProjectionSource,
  type PlayerSearchHit,
  normalizeDiscoveryTerm,
} from './index'

type Sql = ReturnType<typeof postgres>
type Term = { kind: 'canonical' | 'segment' | 'alias'; display: string; normalized: string }

class StalePlayerProjectionSnapshotError extends Error {}

function termsFor(fact: PlayerDiscoveryFact): Term[] {
  const terms: Term[] = []
  const seen = new Set<string>()
  const add = (kind: Term['kind'], display: string) => {
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
    DELETE FROM discovery.player_terms
    WHERE generation_id = ${generationId} AND brawlhalla_id = ${brawlhallaId}
  `
  if (!fact) return
  const terms = termsFor(fact)
  if (terms.length === 0) return
  await sql`
    INSERT INTO discovery.player_terms ${sql(
      terms.map((term) => ({
        generation_id: generationId,
        brawlhalla_id: fact.brawlhallaId,
        term_kind: term.kind,
        display_term: term.display,
        normalized_term: term.normalized,
        canonical_name: fact.name,
        region: fact.region,
        rating: fact.rating,
        view_count: fact.viewCount,
        best_legend_name_key: fact.bestLegendNameKey,
      })),
    )}
  `
}

export function createPostgresDiscovery(connectionString: string): DiscoveryQueries & {
  applyPlayerEvents(events: PlayerProjectionEvent[], operationId?: string): Promise<{ appliedEvents: number }>
  deliverPendingPlayers(
    source: PlayerProjectionSource,
    limit: number,
    operationId?: string,
  ): Promise<{ appliedEvents: number; eventIds: string[] }>
  rebuildPlayers(snapshot: PlayerProjectionSnapshot): Promise<void>
  rebuildPlayersFrom(source: PlayerProjectionSource): Promise<void>
  playerProjectionEffectState(operationId: string): Promise<'none' | 'applied' | 'acknowledged'>
  close(): Promise<void>
} {
  const client = postgres(connectionString)

  return {
    async searchPlayers(rawQuery): Promise<PlayerSearchHit[]> {
      const query = normalizeDiscoveryTerm(rawQuery)
      if ([...query].length < 2) return []
      const upperBound = `${query}\u{10ffff}`
      const rows = await client<
        Array<{
          brawlhalla_id: number
          canonical_name: string
          region: string | null
          rating: number | null
          view_count: number
          best_legend_name_key: string | null
          term_kind: Term['kind']
          display_term: string
        }>
      >`
        WITH candidates AS (
          SELECT term.*,
                 term.normalized_term = ${query} COLLATE "C" AS exact_match,
                 CASE WHEN term.term_kind = 'alias' THEN 1 ELSE 0 END AS alias_rank,
                 CASE term.term_kind WHEN 'canonical' THEN 0 WHEN 'segment' THEN 1 ELSE 2 END AS stable_term_rank
          FROM discovery.player_terms term
          JOIN discovery.player_generations generation
            ON generation.generation_id = term.generation_id AND generation.active
          WHERE term.normalized_term >= ${query} COLLATE "C"
            AND term.normalized_term < ${upperBound} COLLATE "C"
        ), winners AS (
          SELECT DISTINCT ON (brawlhalla_id) *
          FROM candidates
          ORDER BY brawlhalla_id, exact_match DESC, alias_rank, stable_term_rank,
                   normalized_term, display_term
        )
        SELECT brawlhalla_id, canonical_name, region, rating, view_count,
               best_legend_name_key, term_kind, display_term
        FROM winners
        ORDER BY exact_match DESC, alias_rank, rating DESC NULLS LAST,
                 view_count DESC, brawlhalla_id
        LIMIT 40
      `
      return rows.map((row) => ({
        brawlhallaId: row.brawlhalla_id,
        name: row.canonical_name,
        region: row.region,
        rating: row.rating,
        viewCount: row.view_count,
        bestLegendNameKey: row.best_legend_name_key,
        matchedAlias: row.term_kind === 'alias' ? row.display_term : null,
      }))
    },

    async applyPlayerEvents(events, operationId) {
      if (events.length === 0 && !operationId) return { appliedEvents: 0 }
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        await sql`SELECT pg_advisory_xact_lock(hashtextextended('discovery:players', 199))`
        const [generation] = await sql<{ generation_id: string; source_version: string | number }[]>`
          SELECT generation_id, source_version
          FROM discovery.player_generations WHERE active FOR UPDATE
        `
        let appliedEvents = 0
        let projectedVersion = Number(generation.source_version)
        for (const event of events) {
          const inserted = await sql<{ event_id: string }[]>`
            INSERT INTO discovery.player_event_receipts (event_id)
            VALUES (${event.eventId})
            ON CONFLICT DO NOTHING
            RETURNING event_id
          `
          if (!inserted[0]) continue
          if (event.sourceVersion >= projectedVersion) {
            await replacePlayer(sql, generation.generation_id, event.fact, event.brawlhallaId)
            projectedVersion = event.sourceVersion
          }
          appliedEvents++
        }
        await sql`
          UPDATE discovery.player_generations
          SET source_version = GREATEST(source_version, ${projectedVersion})
          WHERE generation_id = ${generation.generation_id}
        `
        if (operationId) {
          await sql`
            INSERT INTO discovery.player_projection_effects (operation_id, source_version)
            VALUES (${operationId}::uuid, ${projectedVersion})
            ON CONFLICT DO NOTHING
          `
        }
        return { appliedEvents }
      })
    },

    async deliverPendingPlayers(source, limit, operationId) {
      const events = await source.pendingEvents(limit)
      const result = await this.applyPlayerEvents(events, operationId)
      const eventIds = events.map(({ eventId }) => eventId)
      await source.acknowledgeEvents(eventIds)
      if (operationId) {
        await client`
          UPDATE discovery.player_projection_effects
          SET acknowledged_at = COALESCE(acknowledged_at, clock_timestamp())
          WHERE operation_id = ${operationId}::uuid
        `
      }
      return { ...result, eventIds }
    },

    async rebuildPlayers(snapshot) {
      await client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        await sql`SELECT pg_advisory_xact_lock(hashtextextended('discovery:players', 199))`
        const [active] = await sql<{ source_version: string | number }[]>`
          SELECT source_version
          FROM discovery.player_generations WHERE active FOR UPDATE
        `
        if (Number(active.source_version) > snapshot.sourceVersion) throw new StalePlayerProjectionSnapshotError()
        const [generation] = await sql<{ generation_id: string }[]>`
          INSERT INTO discovery.player_generations (source_version)
          VALUES (${snapshot.sourceVersion})
          RETURNING generation_id
        `
        for (const fact of [...snapshot.facts].sort((left, right) => left.brawlhallaId - right.brawlhallaId)) {
          await replacePlayer(sql, generation.generation_id, fact, fact.brawlhallaId)
        }
        await sql`UPDATE discovery.player_generations SET active = false WHERE active`
        await sql`UPDATE discovery.player_generations SET active = true WHERE generation_id = ${generation.generation_id}`
        await sql`DELETE FROM discovery.player_generations WHERE NOT active`
      })
    },

    async rebuildPlayersFrom(source) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.rebuildPlayers(await source.snapshot())
          return
        } catch (error) {
          if (!(error instanceof StalePlayerProjectionSnapshotError) || attempt === 2) throw error
        }
      }
    },

    async playerProjectionEffectState(operationId) {
      const [effect] = await client<{ acknowledged_at: Date | null }[]>`
        SELECT acknowledged_at
        FROM discovery.player_projection_effects
        WHERE operation_id = ${operationId}::uuid
      `
      if (!effect) return 'none'
      return effect.acknowledged_at ? 'acknowledged' : 'applied'
    },

    close: () => client.end(),
  }
}

export type PostgresDiscovery = ReturnType<typeof createPostgresDiscovery>
