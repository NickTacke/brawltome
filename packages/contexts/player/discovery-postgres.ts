import postgres from 'postgres'
import type { PlayerDiscoveryFact, PlayerDiscoverySource } from './discovery-facts'

type Sql = ReturnType<typeof postgres>
type FactRow = {
  brawlhalla_id: number
  player_name: string | null
  region: string | null
  rating: number | null
  ranked_main_legend_name_key: string | null
}
type LegacyRow = {
  brawlhalla_id: number
  player_name: string
  region: string | null
  rating: number | null
  view_count: number
}
type AliasRow = { brawlhalla_id: number; display_alias: string }

async function sourceVersion(sql: Sql): Promise<number> {
  const [state] = await sql<{ source_version: string | number }[]>`
    SELECT source_version FROM players.discovery_state WHERE singleton
  `
  return Number(state.source_version)
}

async function readFacts(sql: Sql, requestedIds?: number[]): Promise<PlayerDiscoveryFact[]> {
  if (requestedIds && requestedIds.length === 0) return []
  const ranked = await sql<FactRow[]>`
    SELECT brawlhalla_id, player_name, region, rating, ranked_main_legend_name_key
    FROM players.ranked_profiles
    ${requestedIds ? sql`WHERE brawlhalla_id IN ${sql(requestedIds)}` : sql``}
  `
  const legacy = await sql<LegacyRow[]>`
    SELECT brawlhalla_id, player_name, region, rating, view_count
    FROM players.legacy_discovery_profiles
    ${requestedIds ? sql`WHERE brawlhalla_id IN ${sql(requestedIds)}` : sql``}
  `
  const canonicalAliases = await sql<AliasRow[]>`
    SELECT brawlhalla_id, display_alias
    FROM players.discovery_aliases
    ${requestedIds ? sql`WHERE brawlhalla_id IN ${sql(requestedIds)}` : sql``}
    ORDER BY observed_at DESC, normalized_alias
  `
  const legacyAliases = await sql<AliasRow[]>`
    SELECT brawlhalla_id, display_alias
    FROM players.legacy_discovery_aliases
    ${requestedIds ? sql`WHERE brawlhalla_id IN ${sql(requestedIds)}` : sql``}
    ORDER BY observed_at DESC, normalized_alias
  `

  const rankedById = new Map(ranked.map((row) => [row.brawlhalla_id, row]))
  const legacyById = new Map(legacy.map((row) => [row.brawlhalla_id, row]))
  const aliasesById = new Map<number, string[]>()
  for (const alias of [...canonicalAliases, ...legacyAliases]) {
    const aliases = aliasesById.get(alias.brawlhalla_id) ?? []
    if (!aliases.includes(alias.display_alias)) aliases.push(alias.display_alias)
    aliasesById.set(alias.brawlhalla_id, aliases)
  }

  const identities = new Set([...rankedById.keys(), ...legacyById.keys()])
  return [...identities]
    .sort((left, right) => left - right)
    .flatMap((brawlhallaId) => {
      const canonical = rankedById.get(brawlhallaId)
      const fallback = legacyById.get(brawlhallaId)
      const name = canonical?.player_name ?? fallback?.player_name
      if (!name || [...name].length > 256 || !/[^\p{Separator}\p{Format}]/u.test(name)) return []
      const canonicalAvailable = canonical?.player_name !== null && canonical?.player_name !== undefined
      const aliases = aliasesById.get(brawlhallaId) ?? []
      if (
        canonicalAvailable &&
        fallback?.player_name &&
        fallback.player_name !== name &&
        !aliases.includes(fallback.player_name)
      ) {
        aliases.push(fallback.player_name)
      }
      const rawRating = canonicalAvailable ? canonical.rating : fallback?.rating
      return [
        {
          brawlhallaId,
          name,
          region: canonicalAvailable ? canonical.region : (fallback?.region ?? null),
          rating:
            rawRating !== undefined && rawRating !== null && rawRating >= 0 && (canonicalAvailable || rawRating > 0)
              ? rawRating
              : null,
          viewCount: Math.max(0, fallback?.view_count ?? 0),
          bestLegendNameKey: canonical?.ranked_main_legend_name_key ?? null,
          aliases,
        },
      ]
    })
}

export function createPostgresPlayerDiscoverySource(connectionString: string): PlayerDiscoverySource & {
  close(): Promise<void>
} {
  const client = postgres(connectionString)
  return {
    async pendingEvents(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('Player discovery event limit must be between 1 and 1000')
      }
      return client.begin('isolation level repeatable read read only', async (transaction) => {
        const sql = transaction as unknown as Sql
        const events = await sql<{ event_id: string; brawlhalla_id: number }[]>`
          SELECT event_id, brawlhalla_id
          FROM players.discovery_outbox
          WHERE delivered_at IS NULL
          ORDER BY created_at, event_id
          LIMIT ${limit}
        `
        const facts = new Map(
          (await readFacts(sql, [...new Set(events.map(({ brawlhalla_id }) => brawlhalla_id))])).map((fact) => [
            fact.brawlhallaId,
            fact,
          ]),
        )
        const version = await sourceVersion(sql)
        return events.map((event) => ({
          eventId: event.event_id,
          brawlhallaId: event.brawlhalla_id,
          sourceVersion: version,
          fact: facts.get(event.brawlhalla_id) ?? null,
        }))
      })
    },

    async acknowledgeEvents(eventIds) {
      if (eventIds.length === 0) return
      await client`
        UPDATE players.discovery_outbox SET delivered_at = clock_timestamp()
        WHERE event_id IN ${client(eventIds)} AND delivered_at IS NULL
      `
    },

    async replayDeliveredEvents(eventIds) {
      if (eventIds.length === 0) return
      await client`
        UPDATE players.discovery_outbox SET delivered_at = NULL
        WHERE event_id IN ${client(eventIds)}
      `
    },

    snapshot() {
      return client.begin('isolation level repeatable read read only', async (transaction) => {
        const sql = transaction as unknown as Sql
        const [pending] = await sql<{ pending_count: number; oldest_pending_at: Date | null }[]>`
          SELECT count(*)::integer AS pending_count, min(created_at) AS oldest_pending_at
          FROM players.discovery_outbox WHERE delivered_at IS NULL
        `
        return {
          sourceVersion: await sourceVersion(sql),
          facts: await readFacts(sql),
          pendingEventCount: pending.pending_count,
          oldestPendingAt: pending.oldest_pending_at,
        }
      })
    },

    async lag() {
      const [row] = await client<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM players.discovery_outbox WHERE delivered_at IS NULL
      `
      return row.count
    },

    close: () => client.end(),
  }
}

export type PostgresPlayerDiscoverySource = ReturnType<typeof createPostgresPlayerDiscoverySource>
