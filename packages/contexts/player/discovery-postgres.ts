import { getLegendById } from '@brawltome/game-data/legends'
import { legendSlug } from '@brawltome/game-data/reference-data'
import postgres from 'postgres'
import { decodeV0CareerNameCandidate } from './career/source'
import type { PlayerDiscoveryFact, PlayerDiscoverySnapshotStream, PlayerDiscoverySource } from './discovery-facts'
import { isUsablePlayerName, selectCanonicalPlayerName } from './reference'

type Sql = ReturnType<typeof postgres>
type FactRow = {
  brawlhalla_id: number
  player_name: string | null
  last_success_at: Date | null
  region: string | null
  rating: number | null
  ranked_main_legend_name_key: string | null
}
type CareerProfileRow = { brawlhalla_id: number; player_name: string | null }
type LegacyRow = {
  brawlhalla_id: number
  player_name: string
  region: string | null
  rating: number | null
  view_count: number
  best_legend: number | null
}
type AliasRow = { brawlhalla_id: number; display_alias: string }
type CareerLegendRow = { brawlhalla_id: number; legend_name_key: string }

const snapshotBatchSize = 1_000

export type LegacyPlayerMigrationEvidence = {
  status: 'not-started' | 'in-progress' | 'complete' | 'blocked'
  sourceChecksum: string | null
  rejectedIdentities: Array<{ brawlhallaId: number; playerName: string; reasons: string[] }>
}

async function sourceVersion(sql: Sql): Promise<number> {
  const [state] = await sql<{ source_version: string | number }[]>`
    SELECT source_version FROM players.discovery_state WHERE singleton
  `
  return Number(state.source_version)
}

async function readFacts(sql: Sql, requestedIds?: number[]): Promise<PlayerDiscoveryFact[]> {
  if (requestedIds && requestedIds.length === 0) return []
  const ranked = await sql<FactRow[]>`
    SELECT brawlhalla_id, player_name, last_success_at, region, rating, ranked_main_legend_name_key
    FROM players.ranked_profiles
    ${requestedIds ? sql`WHERE brawlhalla_id IN ${sql(requestedIds)}` : sql``}
  `
  const careers = await sql<CareerProfileRow[]>`
    SELECT brawlhalla_id, player_name
    FROM players.career_profiles
    ${requestedIds ? sql`WHERE brawlhalla_id IN ${sql(requestedIds)}` : sql``}
  `
  const careerLegends = await sql<CareerLegendRow[]>`
    SELECT DISTINCT ON (brawlhalla_id) brawlhalla_id, legend_name_key
    FROM players.career_legends
    ${requestedIds ? sql`WHERE brawlhalla_id IN ${sql(requestedIds)}` : sql``}
    ORDER BY brawlhalla_id, xp DESC, level DESC, ordinal
  `
  const legacy = await sql<LegacyRow[]>`
    SELECT brawlhalla_id, player_name, region, rating, view_count, NULL::integer AS best_legend
    FROM players.legacy_discovery_profiles
    ${requestedIds ? sql`WHERE brawlhalla_id IN ${sql(requestedIds)}` : sql``}
  `
  const profileLegacy = await sql<LegacyRow[]>`
    SELECT brawlhalla_id, player_name, NULL::text AS region, rating, 0 AS view_count, best_legend
    FROM players.legacy_profile_discovery
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
  const careerById = new Map(careers.map((row) => [row.brawlhalla_id, row]))
  const careerLegendById = new Map(careerLegends.map((row) => [row.brawlhalla_id, row.legend_name_key]))
  const profileLegacyById = new Map(profileLegacy.map((row) => [row.brawlhalla_id, row]))
  const legacyById = new Map(profileLegacyById)
  for (const row of legacy) {
    legacyById.set(row.brawlhalla_id, {
      ...row,
      best_legend: row.best_legend ?? profileLegacyById.get(row.brawlhalla_id)?.best_legend ?? null,
    })
  }
  const aliasesById = new Map<number, string[]>()
  for (const alias of [...canonicalAliases, ...legacyAliases]) {
    const aliases = aliasesById.get(alias.brawlhalla_id) ?? []
    if (!aliases.includes(alias.display_alias)) aliases.push(alias.display_alias)
    aliasesById.set(alias.brawlhalla_id, aliases)
  }

  const identities = new Set([...rankedById.keys(), ...careerById.keys(), ...legacyById.keys()])
  return [...identities]
    .sort((left, right) => left - right)
    .flatMap((brawlhallaId) => {
      const canonical = rankedById.get(brawlhallaId)
      const career = careerById.get(brawlhallaId)
      const fallback = legacyById.get(brawlhallaId)
      const nameEvidence = selectCanonicalPlayerName({
        brawlhallaId,
        ranked: canonical?.player_name ? { name: canonical.player_name } : null,
        career: career?.player_name ? { name: career.player_name } : null,
      })
      const name = nameEvidence?.name ?? fallback?.player_name
      if (!name || !isUsablePlayerName(name, brawlhallaId)) return []
      const canonicalAvailable = canonical?.last_success_at !== null && canonical?.last_success_at !== undefined
      const aliases = (aliasesById.get(brawlhallaId) ?? []).filter(
        (alias) => decodeV0CareerNameCandidate(alias) !== name,
      )
      for (const candidate of [canonical?.player_name, career?.player_name, fallback?.player_name]) {
        if (
          candidate &&
          candidate !== name &&
          isUsablePlayerName(candidate, brawlhallaId) &&
          decodeV0CareerNameCandidate(candidate) !== name &&
          !aliases.includes(candidate)
        ) {
          aliases.push(candidate)
        }
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
          bestLegendNameKey:
            canonical?.ranked_main_legend_name_key ??
            careerLegendById.get(brawlhallaId) ??
            (() => {
              const legend = getLegendById(fallback?.best_legend ?? 0)
              return legend ? legendSlug(legend.heroId, legend.displayName) : null
            })(),
          aliases,
        },
      ]
    })
}

export function createPostgresPlayerDiscoverySource(connectionString: string): PlayerDiscoverySource & {
  legacyMigrationEvidence(): Promise<LegacyPlayerMigrationEvidence>
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

    async withSnapshot<T>(consume: (snapshot: PlayerDiscoverySnapshotStream) => Promise<T>) {
      return (await client.begin('isolation level repeatable read read only', async (transaction) => {
        const sql = transaction as unknown as Sql
        const [pending] = await sql<{ pending_count: number; oldest_pending_at: Date | null }[]>`
          SELECT count(*)::integer AS pending_count, min(created_at) AS oldest_pending_at
          FROM players.discovery_outbox WHERE delivered_at IS NULL
        `
        const version = await sourceVersion(sql)
        return consume({
          sourceVersion: version,
          pendingEventCount: pending.pending_count,
          oldestPendingAt: pending.oldest_pending_at,
          facts: async function* () {
            let afterId = 0
            while (true) {
              const rows = await sql<{ brawlhalla_id: number }[]>`
                SELECT brawlhalla_id
                FROM (
                  SELECT brawlhalla_id FROM players.ranked_profiles WHERE brawlhalla_id > ${afterId}
                  UNION
                  SELECT brawlhalla_id FROM players.career_profiles WHERE brawlhalla_id > ${afterId}
                  UNION
                  SELECT brawlhalla_id FROM players.legacy_discovery_profiles WHERE brawlhalla_id > ${afterId}
                  UNION
                  SELECT brawlhalla_id FROM players.legacy_profile_discovery WHERE brawlhalla_id > ${afterId}
                ) candidate
                ORDER BY brawlhalla_id
                LIMIT ${snapshotBatchSize}
              `
              if (rows.length === 0) return
              afterId = rows.at(-1)?.brawlhalla_id ?? afterId
              for (const fact of await readFacts(
                sql,
                rows.map(({ brawlhalla_id }) => brawlhalla_id),
              )) {
                yield fact
              }
            }
          },
        })
      })) as T
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

    async legacyMigrationEvidence(): Promise<LegacyPlayerMigrationEvidence> {
      const [progress] = await client<{ status: 'in-progress' | 'complete' | 'blocked'; source_checksum: string }[]>`
        SELECT status, source_checksum
        FROM (
          SELECT status, source_checksum, 0 AS source_rank FROM players.legacy_import_progress
          UNION ALL
          SELECT status, source_checksum, 1 AS source_rank FROM players.legacy_profile_import_progress
        ) migration
        ORDER BY (status = 'complete') DESC, source_rank
        LIMIT 1
      `
      const rejectedIdentities = await client<Array<{ brawlhalla_id: number; player_name: string; reasons: string[] }>>`
        WITH archived AS (
          SELECT archive.source_key, archive.raw_row,
                 CASE
                   WHEN archive.raw_row->>'brawlhalla_id' ~ '^-?[0-9]+$'
                    AND (archive.raw_row->>'brawlhalla_id')::numeric BETWEEN -2147483648 AND 2147483647
                   THEN (archive.raw_row->>'brawlhalla_id')::integer
                 END AS brawlhalla_id,
                 archive.raw_row->>'name' AS player_name
          FROM players.legacy_archive archive
          WHERE archive.source_table = 'player'
        )
        SELECT archived.brawlhalla_id, archived.player_name,
               array_agg(rejection.code ORDER BY rejection.code) AS reasons
        FROM archived
        JOIN players.legacy_import_rejections rejection
          ON rejection.source_table = 'player' AND rejection.source_key = archived.source_key
        LEFT JOIN players.legacy_discovery_profiles profile
          ON profile.brawlhalla_id = archived.brawlhalla_id
        WHERE archived.brawlhalla_id IS NOT NULL
          AND archived.player_name IS NOT NULL
          AND archived.player_name ~ '[^[:space:]]'
          AND profile.brawlhalla_id IS NULL
        GROUP BY archived.source_key, archived.brawlhalla_id, archived.player_name
        UNION ALL
        SELECT archive.brawlhalla_id, archive.raw_row->>'name' AS player_name,
               ARRAY[rejection.code] AS reasons
        FROM players.legacy_profile_archive archive
        JOIN players.legacy_profile_import_rejections rejection USING (brawlhalla_id)
        LEFT JOIN players.legacy_profile_discovery profile USING (brawlhalla_id)
        WHERE archive.raw_row->>'name' IS NOT NULL
          AND archive.raw_row->>'name' ~ '[^[:space:]]'
          AND profile.brawlhalla_id IS NULL
        ORDER BY brawlhalla_id
      `
      return {
        status: progress?.status ?? 'not-started',
        sourceChecksum: progress?.source_checksum.trim() ?? null,
        rejectedIdentities: rejectedIdentities.map((identity) => ({
          brawlhallaId: identity.brawlhalla_id,
          playerName: identity.player_name,
          reasons: identity.reasons,
        })),
      }
    },

    close: () => client.end(),
  }
}

export type PostgresPlayerDiscoverySource = ReturnType<typeof createPostgresPlayerDiscoverySource>
