import postgres from 'postgres'
import { decodeV0CareerNameCandidate } from './career/source'
import { isUsablePlayerName } from './reference'

type Sql = ReturnType<typeof postgres>

export type LeaderboardPlayerName = { brawlhallaId: number; name: string }

type ChangedRow = { brawlhalla_id: number; player_name: string; previous_name: string | null }

const INT32_MAX = 2_147_483_647

function leaderboardNamesById(players: readonly LeaderboardPlayerName[]): Map<number, string> {
  const names = new Map<number, string>()
  for (const { brawlhallaId, name } of players) {
    if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1 || brawlhallaId > INT32_MAX) continue
    // Ranking substitutes this placeholder for blank V1 usernames; it is not a name the player chose.
    if (name === `Name unavailable #${brawlhallaId}` || !isUsablePlayerName(name, brawlhallaId)) continue
    if (!names.has(brawlhallaId)) names.set(brawlhallaId, name)
  }
  return names
}

export function createPostgresLeaderboardPlayerNames(connectionString: string) {
  const client = postgres(connectionString)

  return {
    // Records the names a published leaderboard observed. Only identities whose leaderboard name changed (or that
    // were never observed) are written, so a steady-state scan touches no rows and enqueues no discovery facts.
    async applyLeaderboardNames(input: {
      observedAt: Date
      players: readonly LeaderboardPlayerName[]
    }): Promise<{ changed: number }> {
      const names = leaderboardNamesById(input.players)
      if (names.size === 0) return { changed: 0 }
      const brawlhallaIds = [...names.keys()].sort((left, right) => left - right)
      const playerNames = brawlhallaIds.map((brawlhallaId) => names.get(brawlhallaId) as string)
      const repairedNames = playerNames.map((name) => decodeV0CareerNameCandidate(name) ?? '')

      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        await sql`SELECT pg_advisory_xact_lock(hashtext('players.leaderboard_name_observations'))`
        const changed = await sql<ChangedRow[]>`
          WITH input AS (
            SELECT brawlhalla_id, player_name, NULLIF(repaired_name, '') AS repaired_name
            FROM unnest(${brawlhallaIds}::integer[], ${playerNames}::text[], ${repairedNames}::text[])
              AS input(brawlhalla_id, player_name, repaired_name)
          ),
          resolved AS (
            SELECT input.brawlhalla_id,
                   CASE WHEN input.repaired_name IS NOT NULL AND input.repaired_name IN (
                     SELECT player_name FROM players.ranked_profiles
                     WHERE brawlhalla_id = input.brawlhalla_id AND player_name IS NOT NULL
                     UNION ALL
                     SELECT player_name FROM players.career_profiles
                     WHERE brawlhalla_id = input.brawlhalla_id AND player_name IS NOT NULL
                     UNION ALL
                     SELECT display_alias FROM players.discovery_aliases WHERE brawlhalla_id = input.brawlhalla_id
                     UNION ALL
                     SELECT player_name FROM players.legacy_discovery_profiles WHERE brawlhalla_id = input.brawlhalla_id
                     UNION ALL
                     SELECT display_alias FROM players.legacy_discovery_aliases WHERE brawlhalla_id = input.brawlhalla_id
                     UNION ALL
                     SELECT player_name FROM players.legacy_profile_discovery WHERE brawlhalla_id = input.brawlhalla_id
                     UNION ALL
                     SELECT player_name FROM players.leaderboard_name_observations
                     WHERE brawlhalla_id = input.brawlhalla_id
                   ) THEN input.repaired_name ELSE input.player_name END AS player_name
            FROM input
          ),
          pending AS MATERIALIZED (
            SELECT resolved.brawlhalla_id, resolved.player_name
            FROM resolved
            LEFT JOIN players.leaderboard_name_observations observation USING (brawlhalla_id)
            WHERE observation.brawlhalla_id IS NULL
               OR (observation.player_name <> resolved.player_name AND observation.observed_at < ${input.observedAt})
          ),
          changed AS (
            SELECT pending.brawlhalla_id, pending.player_name,
                   -- A live V0 name stays canonical, so a leaderboard change does not displace it into an alias.
                   CASE WHEN previous.observed_at < ${input.observedAt} AND NOT EXISTS (
                     SELECT 1 FROM players.ranked_profiles
                     WHERE brawlhalla_id = pending.brawlhalla_id AND last_success_at IS NOT NULL
                       AND player_name IS NOT NULL
                     UNION ALL
                     SELECT 1 FROM players.career_profiles
                     WHERE brawlhalla_id = pending.brawlhalla_id AND last_success_at IS NOT NULL
                       AND player_name IS NOT NULL AND snapshot_source <> 'legacy-v2'
                   ) THEN previous.player_name END AS previous_name
            FROM pending
            LEFT JOIN LATERAL (
              SELECT candidate.player_name, candidate.observed_at
              FROM (
                SELECT player_name, last_success_at AS observed_at, 0 AS priority FROM players.career_profiles
                WHERE brawlhalla_id = pending.brawlhalla_id AND last_success_at IS NOT NULL
                  AND player_name IS NOT NULL
                UNION ALL
                SELECT player_name, last_success_at, 1 FROM players.ranked_profiles
                WHERE brawlhalla_id = pending.brawlhalla_id AND last_success_at IS NOT NULL
                  AND player_name IS NOT NULL
                UNION ALL
                SELECT player_name, observed_at, 2 FROM players.leaderboard_name_observations
                WHERE brawlhalla_id = pending.brawlhalla_id
              ) candidate
              ORDER BY candidate.observed_at DESC, candidate.priority
              LIMIT 1
            ) previous ON true
          ),
          written AS (
            INSERT INTO players.leaderboard_name_observations AS current (brawlhalla_id, player_name, observed_at)
            SELECT brawlhalla_id, player_name, ${input.observedAt} FROM changed ORDER BY brawlhalla_id
            ON CONFLICT (brawlhalla_id) DO UPDATE SET
              player_name = EXCLUDED.player_name,
              observed_at = EXCLUDED.observed_at,
              -- Lets name verification spot a rename V1 itself saw.
              previous_player_name = current.player_name
            WHERE current.observed_at < EXCLUDED.observed_at
            RETURNING brawlhalla_id
          )
          SELECT changed.brawlhalla_id, changed.player_name, changed.previous_name
          FROM changed JOIN written USING (brawlhalla_id)
          ORDER BY changed.brawlhalla_id
        `
        if (changed.length === 0) return { changed: 0 }

        const aliases = changed.filter(
          ({ brawlhalla_id, player_name, previous_name }): boolean =>
            !!previous_name &&
            previous_name !== player_name &&
            decodeV0CareerNameCandidate(previous_name) !== player_name &&
            isUsablePlayerName(previous_name, brawlhalla_id),
        ) as Array<ChangedRow & { previous_name: string }>
        if (aliases.length > 0) {
          // The outbox insert below already covers these identities; skip the per-row alias trigger.
          await sql`SELECT set_config('players.suppress_discovery_outbox', 'on', true)`
          await sql`
            INSERT INTO players.discovery_aliases (brawlhalla_id, normalized_alias, display_alias, observed_at)
            SELECT brawlhalla_id, normalized_alias, display_alias, ${input.observedAt}
            FROM unnest(
              ${aliases.map(({ brawlhalla_id }) => brawlhalla_id)}::integer[],
              ${aliases.map(({ previous_name }) => previous_name.toLowerCase())}::text[],
              ${aliases.map(({ previous_name }) => previous_name)}::text[]
            ) AS alias(brawlhalla_id, normalized_alias, display_alias)
            ON CONFLICT (brawlhalla_id, normalized_alias) DO UPDATE
            SET display_alias = EXCLUDED.display_alias, observed_at = EXCLUDED.observed_at
          `
          await sql`SELECT set_config('players.suppress_discovery_outbox', 'off', true)`
        }
        await sql`
          WITH version AS (
            UPDATE players.discovery_state
            SET source_version = source_version + 1
            WHERE singleton
            RETURNING source_version
          )
          INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
          SELECT changed.brawlhalla_id, version.source_version
          FROM unnest(${changed.map(({ brawlhalla_id }) => brawlhalla_id)}::integer[]) AS changed(brawlhalla_id)
          CROSS JOIN version
        `
        return { changed: changed.length }
      })
    },

    async referenceById(
      brawlhallaId: number,
    ): Promise<{ brawlhallaId: number; name: string; observedAt: Date } | null> {
      const [observation] = await client<{ brawlhalla_id: number; player_name: string; observed_at: Date }[]>`
        SELECT brawlhalla_id, player_name, observed_at
        FROM players.leaderboard_name_observations
        WHERE brawlhalla_id = ${brawlhallaId}
      `
      return observation
        ? {
            brawlhallaId: observation.brawlhalla_id,
            name: observation.player_name,
            observedAt: observation.observed_at,
          }
        : null
    },

    close: () => client.end(),
  }
}

export type PostgresLeaderboardPlayerNames = ReturnType<typeof createPostgresLeaderboardPlayerNames>
