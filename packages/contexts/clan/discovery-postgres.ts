import postgres from 'postgres'
import type { ClanDiscoveryFact, ClanDiscoverySource } from './discovery-facts'

type Sql = ReturnType<typeof postgres>

async function sourceVersion(sql: Sql): Promise<number> {
  const [state] = await sql<{ source_version: string | number }[]>`
    SELECT source_version FROM clans.discovery_state WHERE singleton
  `
  return Number(state.source_version)
}

async function readFacts(sql: Sql, requestedIds?: number[]): Promise<ClanDiscoveryFact[]> {
  if (requestedIds && requestedIds.length === 0) return []
  const rows = await sql<Array<{ clan_id: number; clan_name: string; clan_xp: string; member_count: number }>>`
    SELECT profile.clan_id, profile.clan_name, profile.clan_xp::text,
           count(member.brawlhalla_id)::integer AS member_count
    FROM clans.profiles profile
    LEFT JOIN clans.members member ON member.clan_id = profile.clan_id
    ${requestedIds ? sql`WHERE profile.clan_id IN ${sql(requestedIds)}` : sql``}
    GROUP BY profile.clan_id, profile.clan_name, profile.clan_xp
    ORDER BY profile.clan_id
  `
  return rows.map((row) => ({
    clanId: row.clan_id,
    clanName: row.clan_name,
    clanXp: row.clan_xp,
    memberCount: row.member_count,
  }))
}

export function createPostgresClanDiscoverySource(connectionString: string): ClanDiscoverySource & {
  close(): Promise<void>
} {
  const client = postgres(connectionString)
  return {
    async pendingEvents(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('Clan discovery event limit must be between 1 and 1000')
      }
      return client.begin('isolation level repeatable read read only', async (transaction) => {
        const sql = transaction as unknown as Sql
        const events = await sql<{ event_id: string; clan_id: number }[]>`
          SELECT event_id, clan_id
          FROM clans.discovery_outbox
          WHERE delivered_at IS NULL
          ORDER BY created_at, event_id
          LIMIT ${limit}
        `
        const facts = new Map(
          (await readFacts(sql, [...new Set(events.map(({ clan_id }) => clan_id))])).map((fact) => [fact.clanId, fact]),
        )
        const version = await sourceVersion(sql)
        return events.map((event) => ({
          eventId: event.event_id,
          clanId: event.clan_id,
          sourceVersion: version,
          fact: facts.get(event.clan_id) ?? null,
        }))
      })
    },

    async acknowledgeEvents(eventIds) {
      if (eventIds.length === 0) return
      await client`
        UPDATE clans.discovery_outbox SET delivered_at = clock_timestamp()
        WHERE event_id IN ${client(eventIds)} AND delivered_at IS NULL
      `
    },

    async replayDeliveredEvents(eventIds) {
      if (eventIds.length === 0) return
      await client`
        UPDATE clans.discovery_outbox SET delivered_at = NULL
        WHERE event_id IN ${client(eventIds)}
      `
    },

    snapshot() {
      return client.begin('isolation level repeatable read read only', async (transaction) => {
        const sql = transaction as unknown as Sql
        const [pending] = await sql<{ pending_count: number; oldest_pending_at: Date | null }[]>`
          SELECT count(*)::integer AS pending_count, min(created_at) AS oldest_pending_at
          FROM clans.discovery_outbox WHERE delivered_at IS NULL
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
        SELECT count(*)::integer AS count FROM clans.discovery_outbox WHERE delivered_at IS NULL
      `
      return row.count
    },

    close: () => client.end(),
  }
}

export type PostgresClanDiscoverySource = ReturnType<typeof createPostgresClanDiscoverySource>
