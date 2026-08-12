import { legendSlug } from '@brawltome/game-data'
import { getLegendById } from '@brawltome/game-data/legends'
import postgres from 'postgres'
import {
  type MainLegend,
  RANKED_FRESHNESS_SECONDS,
  type RankedPlayerProfile,
  type RankedPlayerQueries,
  type RankedPulseSourceStatus,
  deriveObservedRatingDirection,
  rankedFreshness,
} from './model'
import type { V0RankedSnapshot, V1RankedPulse } from './source'

export type CanonicalRankedEffect = {
  operationId: string
  effectOperationId?: string
  leaseOwner: string
  leaseToken: number
  effectCreatedAt: string
  section: 'ranked'
}

export type RankedWriteResult = 'applied' | 'already-applied' | 'lease-lost' | 'no-op' | 'stale'
type FencedResult = 'applied' | 'already-applied' | 'lease-lost'
type CanonicalWriteResult = FencedResult | 'stale'
type CareerMainLegendResolver = (brawlhallaId: number) => Promise<Omit<MainLegend, 'source'> | null>
type Sql = ReturnType<typeof postgres>

type ProfileRow = {
  brawlhalla_id: number
  checked_at: Date
  last_success_at: Date | null
  region: string | null
  rating: number | null
  peak_rating: number | null
  tier: string | null
  wins: number | null
  games: number | null
  global_rank: number | null
  region_rank: number | null
  ranked_main_legend_id: number | null
  ranked_main_legend_name_key: string | null
  v0_effect_created_at: string | null
  v0_effect_operation_id: string | null
  pulse_rating: number | null
  pulse_peak_rating: number | null
  pulse_wins: number | null
  pulse_games: number | null
  pulse_effect_created_at: string | null
  pulse_effect_operation_id: string | null
  pulse_checked_at: Date | null
  pulse_last_success_at: Date | null
}

type ValuesRow = {
  rating: number
  peak_rating: number
  tier: string
  wins: number
  games: number
}

type PulseValuesRow = {
  pulse_rating: number | null
  pulse_peak_rating: number | null
  pulse_wins: number | null
  pulse_games: number | null
  pulse_effect_created_at: string | null
  pulse_effect_operation_id: string | null
}

type UpdateOrder = { createdAt: string | null; operationId: string | null }
const RANKED_PLAYER_LOCK_NAMESPACE = 196

async function lockRankedPlayer(sql: Sql, brawlhallaId: number): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${RANKED_PLAYER_LOCK_NAMESPACE}, ${brawlhallaId})`
}

async function acquireLease(sql: Sql, effect: CanonicalRankedEffect): Promise<boolean> {
  const [lease] = await sql<{ active: boolean }[]>`
    SELECT refresh_operations.acquire_active_lease(
      ${effect.operationId}::uuid,
      ${effect.leaseOwner},
      ${effect.leaseToken}
    ) AS active
  `
  return lease?.active === true
}

async function commitInteractiveSection(sql: Sql, effect: CanonicalRankedEffect): Promise<boolean> {
  const [lease] = await sql<{ committed: boolean }[]>`
    SELECT refresh_operations.commit_interactive_section_if_owned(
      ${effect.operationId}::uuid,
      ${effect.leaseOwner},
      ${effect.leaseToken},
      ${effect.section}
    ) AS committed
  `
  return lease?.committed === true
}

function values(row: ValuesRow) {
  return {
    rating: row.rating,
    peakRating: row.peak_rating,
    tier: row.tier,
    wins: row.wins,
    games: row.games,
  }
}

function isNewer(left: UpdateOrder, right: UpdateOrder): boolean {
  if (!left.createdAt) return false
  if (!right.createdAt) return true
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt
  return (left.operationId ?? '') > (right.operationId ?? '')
}

function effectiveValues(row: ValuesRow & PulseValuesRow, canonicalOrder: UpdateOrder) {
  if (
    !isNewer({ createdAt: row.pulse_effect_created_at, operationId: row.pulse_effect_operation_id }, canonicalOrder)
  ) {
    return values(row)
  }
  return {
    rating: row.pulse_rating ?? row.rating,
    peakRating: row.pulse_peak_rating ?? row.peak_rating,
    tier: row.tier,
    wins: row.pulse_wins ?? row.wins,
    games: row.pulse_games ?? row.games,
  }
}

export function createPostgresRankedPlayers(
  connectionString: string,
  options: {
    resolveCareerMainLegend?: CareerMainLegendResolver
    now?: () => Date
  } = {},
): RankedPlayerQueries & {
  referenceById(brawlhallaId: number): Promise<{
    brawlhallaId: number
    name: string
    bestLegendNameKey: string | null
    legacyRating: number | null
  } | null>
  recordChecked(brawlhallaId: number, effect: CanonicalRankedEffect): Promise<FencedResult>
  recordPulseChecked(brawlhallaId: number, effect: CanonicalRankedEffect): Promise<RankedWriteResult>
  pulseStatusById(brawlhallaId: number): Promise<RankedPulseSourceStatus | null>
  applySnapshot(snapshot: V0RankedSnapshot, effect: CanonicalRankedEffect): Promise<CanonicalWriteResult>
  applyPulse(pulse: V1RankedPulse, effect: CanonicalRankedEffect): Promise<RankedWriteResult>
  close(): Promise<void>
} {
  const client = postgres(connectionString)
  const now = options.now ?? (() => new Date())

  return {
    async referenceById(brawlhallaId) {
      const [profile] = await client<
        {
          brawlhalla_id: number
          player_name: string
          legend_name_key: string | null
          best_legend: number | null
          legacy_rating: number | null
        }[]
      >`
        SELECT identity.brawlhalla_id, identity.player_name, identity.legend_name_key,
               profile.best_legend, profile.rating AS legacy_rating
        FROM (
          SELECT ranked.brawlhalla_id, ranked.player_name,
                 ranked.ranked_main_legend_name_key AS legend_name_key, 0 AS source_rank
          FROM players.ranked_profiles ranked
          WHERE ranked.brawlhalla_id = ${brawlhallaId} AND ranked.last_success_at IS NOT NULL
          UNION ALL
          SELECT legacy.brawlhalla_id, legacy.player_name, NULL::text, 1 AS source_rank
          FROM players.legacy_discovery_profiles legacy
          WHERE legacy.brawlhalla_id = ${brawlhallaId}
          UNION ALL
          SELECT profile.brawlhalla_id, profile.player_name, NULL::text, 2 AS source_rank
          FROM players.legacy_profile_discovery profile
          WHERE profile.brawlhalla_id = ${brawlhallaId}
        ) identity
        LEFT JOIN players.legacy_profile_discovery profile USING (brawlhalla_id)
        ORDER BY source_rank
        LIMIT 1
      `
      if (!profile) return null
      return {
        brawlhallaId: profile.brawlhalla_id,
        name: profile.player_name,
        bestLegendNameKey:
          profile.legend_name_key ??
          (() => {
            const legend = getLegendById(profile.best_legend ?? 0)
            return legend ? legendSlug(legend.heroId, legend.displayName) : null
          })(),
        legacyRating: profile.legacy_rating,
      }
    },

    async byId(brawlhallaId) {
      return client.begin('isolation level repeatable read read only', async (transaction) => {
        const sql = transaction as unknown as Sql
        const [profile] = await sql<ProfileRow[]>`
        SELECT profile.brawlhalla_id, profile.checked_at, profile.last_success_at, profile.region,
               profile.rating, profile.peak_rating, profile.tier, profile.wins, profile.games,
               profile.global_rank, profile.region_rank, profile.ranked_main_legend_id,
               profile.ranked_main_legend_name_key,
               to_char(profile.v0_effect_created_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS v0_effect_created_at,
               profile.v0_effect_operation_id, pulse.rating AS pulse_rating,
               pulse.peak_rating AS pulse_peak_rating, pulse.wins AS pulse_wins,
               pulse.games AS pulse_games, pulse.checked_at AS pulse_checked_at,
               pulse.last_success_at AS pulse_last_success_at,
               to_char(pulse.one_vs_one_effect_created_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS pulse_effect_created_at,
               pulse.one_vs_one_effect_operation_id AS pulse_effect_operation_id
        FROM players.ranked_profiles profile
        LEFT JOIN players.ranked_v1_pulse_state pulse USING (brawlhalla_id)
        WHERE profile.brawlhalla_id = ${brawlhallaId}
      `
        if (!profile) return null

        const freshness = rankedFreshness(profile.last_success_at, now())
        const sparsePulse = profile.pulse_checked_at
          ? { checkedAt: profile.pulse_checked_at, lastSuccessAt: profile.pulse_last_success_at }
          : null
        if (!profile.last_success_at) {
          return {
            brawlhallaId,
            checkedAt: profile.checked_at,
            lastSuccessAt: null,
            freshness,
            freshForSeconds: RANKED_FRESHNESS_SECONDS,
            sparsePulse,
            snapshot: null,
          }
        }

        const [legendRows, fixedTeamRows, soloRows, historyRows] = await Promise.all([
          sql<
            Array<
              ValuesRow & {
                legend_id: number
                legend_name_key: string
              }
            >
          >`
          SELECT legend_id, legend_name_key, rating, peak_rating, tier, wins, games
          FROM players.ranked_legends
          WHERE brawlhalla_id = ${brawlhallaId}
          ORDER BY ordinal
        `,
          sql<
            Array<
              ValuesRow &
                PulseValuesRow & {
                  brawlhalla_id_one: number
                  brawlhalla_id_two: number
                  team_name: string
                  region: string
                  global_rank: number | null
                }
            >
          >`
          SELECT team.brawlhalla_id_one, team.brawlhalla_id_two, team.team_name, team.rating,
                 team.peak_rating, team.tier, team.wins, team.games, team.region, team.global_rank,
                 pulse.rating AS pulse_rating, pulse.peak_rating AS pulse_peak_rating,
                 pulse.wins AS pulse_wins, pulse.games AS pulse_games,
                 to_char(pulse.effect_created_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS pulse_effect_created_at,
                 pulse.effect_operation_id AS pulse_effect_operation_id
          FROM players.ranked_fixed_teams team
          LEFT JOIN players.ranked_v1_fixed_team_pulses pulse
            ON pulse.brawlhalla_id = team.brawlhalla_id
            AND pulse.brawlhalla_id_one = LEAST(team.brawlhalla_id_one, team.brawlhalla_id_two)
            AND pulse.brawlhalla_id_two = GREATEST(team.brawlhalla_id_one, team.brawlhalla_id_two)
          WHERE team.brawlhalla_id = ${brawlhallaId}
          ORDER BY team.ordinal
        `,
          sql<
            Array<ValuesRow & { second_player_id: 0; team_name: string; region: string; global_rank: number | null }>
          >`
          SELECT second_player_id, team_name, rating, peak_rating, tier, wins, games, region, global_rank
          FROM players.ranked_solo_queue
          WHERE brawlhalla_id = ${brawlhallaId}
          ORDER BY ordinal
        `,
          sql<Array<ValuesRow & { recorded_at: Date; history_source: 'v0-player-snapshot' | 'v2-legacy' }>>`
          SELECT rating, peak_rating, tier, wins, games, recorded_at, history_source
          FROM players.ranked_rating_history
          WHERE brawlhalla_id = ${brawlhallaId}
          ORDER BY recorded_at DESC, source_order DESC NULLS LAST, id DESC
          LIMIT 365
        `,
        ])

        const canonicalOrder = {
          createdAt: profile.v0_effect_created_at,
          operationId: profile.v0_effect_operation_id,
        }
        const oneVsOneValues = effectiveValues(profile as ProfileRow & ValuesRow, canonicalOrder)
        const rankedMainLegend =
          profile.ranked_main_legend_id && profile.ranked_main_legend_name_key
            ? {
                legendId: profile.ranked_main_legend_id,
                legendNameKey: profile.ranked_main_legend_name_key,
                source: 'current-season' as const,
              }
            : null
        const careerMainLegend = rankedMainLegend ? null : await options.resolveCareerMainLegend?.(brawlhallaId)
        const mainLegend =
          rankedMainLegend ?? (careerMainLegend ? { ...careerMainLegend, source: 'career' as const } : null)
        const ratingHistory = historyRows.map((row) => ({
          ...values(row),
          source: row.history_source === 'v2-legacy' ? ('legacy-v2' as const) : ('v0-player-snapshot' as const),
          recordedAt: row.recorded_at,
        }))

        return {
          brawlhallaId,
          checkedAt: profile.checked_at,
          lastSuccessAt: profile.last_success_at,
          freshness,
          freshForSeconds: RANKED_FRESHNESS_SECONDS,
          sparsePulse,
          snapshot: {
            oneVsOne: {
              ...oneVsOneValues,
              region: profile.region as string,
              globalRank: profile.global_rank,
              regionRank: profile.region_rank,
            },
            rankedLegends: legendRows.map((row) => ({
              legendId: row.legend_id,
              legendNameKey: row.legend_name_key,
              ...values(row),
            })),
            mainLegend,
            fixedTeams: fixedTeamRows.map((row) => ({
              brawlhallaIdOne: row.brawlhalla_id_one,
              brawlhallaIdTwo: row.brawlhalla_id_two,
              teamName: row.team_name,
              region: row.region,
              globalRank: row.global_rank,
              ...effectiveValues(row, canonicalOrder),
            })),
            soloQueue: soloRows.map((row) => ({
              secondPlayerId: row.second_player_id,
              teamName: row.team_name,
              region: row.region,
              globalRank: row.global_rank,
              ...values(row),
            })),
            ratingHistory,
            observedRatingDirection: deriveObservedRatingDirection(ratingHistory),
          },
        } satisfies RankedPlayerProfile
      })
    },

    async recordChecked(brawlhallaId, effect) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        if (!(await acquireLease(sql, effect))) return 'lease-lost' as const
        await sql`
          INSERT INTO players.ranked_profiles (brawlhalla_id, checked_at)
          VALUES (${brawlhallaId}, clock_timestamp())
          ON CONFLICT (brawlhalla_id) DO UPDATE SET checked_at = EXCLUDED.checked_at
        `
        return 'applied' as const
      })
    },

    async recordPulseChecked(brawlhallaId, effect) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        if (!(await commitInteractiveSection(sql, effect))) return 'lease-lost' as const
        await lockRankedPlayer(sql, brawlhallaId)
        const inserted = await sql<{ operation_id: string }[]>`
          INSERT INTO players.interactive_refresh_effects (operation_id, section, lease_token)
          VALUES (${effect.effectOperationId ?? effect.operationId}::uuid, ${effect.section}, ${effect.leaseToken})
          ON CONFLICT (operation_id, section) DO NOTHING
          RETURNING operation_id
        `
        if (!inserted[0]) return 'already-applied' as const
        const recorded = await sql<{ brawlhalla_id: number }[]>`
          INSERT INTO players.ranked_v1_pulse_state (brawlhalla_id, checked_at)
          SELECT brawlhalla_id, clock_timestamp()
          FROM players.ranked_profiles
          WHERE brawlhalla_id = ${brawlhallaId} AND last_success_at IS NOT NULL
          ON CONFLICT (brawlhalla_id) DO UPDATE SET checked_at = EXCLUDED.checked_at
          RETURNING brawlhalla_id
        `
        return recorded[0] ? ('applied' as const) : ('no-op' as const)
      })
    },

    async pulseStatusById(brawlhallaId) {
      const [status] = await client<{ checked_at: Date; last_success_at: Date | null }[]>`
        SELECT checked_at, last_success_at
        FROM players.ranked_v1_pulse_state
        WHERE brawlhalla_id = ${brawlhallaId}
      `
      return status ? { checkedAt: status.checked_at, lastSuccessAt: status.last_success_at } : null
    },

    async applySnapshot(snapshot, effect) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        if (!(await commitInteractiveSection(sql, effect))) return 'lease-lost' as const
        await lockRankedPlayer(sql, snapshot.brawlhallaId)
        const inserted = await sql<{ operation_id: string }[]>`
          INSERT INTO players.interactive_refresh_effects (operation_id, section, lease_token)
          VALUES (${effect.effectOperationId ?? effect.operationId}::uuid, ${effect.section}, ${effect.leaseToken})
          ON CONFLICT (operation_id, section) DO NOTHING
          RETURNING operation_id
        `
        if (!inserted[0]) return 'already-applied' as const

        const [current] = await sql<{ v0_effect_created_at: string | null; v0_effect_operation_id: string | null }[]>`
          SELECT to_char(v0_effect_created_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS v0_effect_created_at,
                 v0_effect_operation_id
          FROM players.ranked_profiles
          WHERE brawlhalla_id = ${snapshot.brawlhallaId}
          FOR UPDATE
        `
        if (
          current &&
          !isNewer(
            { createdAt: effect.effectCreatedAt, operationId: effect.effectOperationId ?? effect.operationId },
            { createdAt: current.v0_effect_created_at, operationId: current.v0_effect_operation_id },
          )
        ) {
          return 'stale' as const
        }

        const [clock] = await sql<{ observed_at: Date }[]>`SELECT clock_timestamp() AS observed_at`
        const observedAt = clock.observed_at
        const [previous] = await sql<{ player_name: string | null }[]>`
          SELECT player_name FROM players.ranked_profiles WHERE brawlhalla_id = ${snapshot.brawlhallaId}
        `
        const one = snapshot.oneVsOne
        await sql`
          INSERT INTO players.ranked_profiles
            (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating,
             tier, wins, games, global_rank, region_rank, ranked_main_legend_id,
             ranked_main_legend_name_key, v0_effect_created_at, v0_effect_operation_id)
          VALUES
            (${snapshot.brawlhallaId}, ${snapshot.name}, ${observedAt}, ${observedAt}, ${one.region},
             ${one.rating}, ${one.peakRating}, ${one.tier}, ${one.wins}, ${one.games}, ${one.globalRank},
             ${one.regionRank}, ${snapshot.rankedMainLegend?.legendId ?? null},
             ${snapshot.rankedMainLegend?.legendNameKey ?? null}, ${effect.effectCreatedAt},
             ${effect.effectOperationId ?? effect.operationId}::uuid)
          ON CONFLICT (brawlhalla_id) DO UPDATE SET
            player_name = EXCLUDED.player_name,
            checked_at = EXCLUDED.checked_at,
            last_success_at = EXCLUDED.last_success_at,
            region = EXCLUDED.region,
            rating = EXCLUDED.rating,
            peak_rating = EXCLUDED.peak_rating,
            tier = EXCLUDED.tier,
            wins = EXCLUDED.wins,
            games = EXCLUDED.games,
            global_rank = EXCLUDED.global_rank,
            region_rank = EXCLUDED.region_rank,
            ranked_main_legend_id = EXCLUDED.ranked_main_legend_id,
            ranked_main_legend_name_key = EXCLUDED.ranked_main_legend_name_key,
            v0_effect_created_at = EXCLUDED.v0_effect_created_at,
            v0_effect_operation_id = EXCLUDED.v0_effect_operation_id
        `

        await sql`
          UPDATE players.ranked_v1_pulse_state
          SET rating = NULL, peak_rating = NULL, wins = NULL, games = NULL,
              one_vs_one_effect_created_at = NULL, one_vs_one_effect_operation_id = NULL
          WHERE brawlhalla_id = ${snapshot.brawlhallaId}
            AND (one_vs_one_effect_created_at, one_vs_one_effect_operation_id::text) <=
              (${effect.effectCreatedAt}::timestamptz, ${effect.effectOperationId ?? effect.operationId}::text)
        `
        await sql`
          DELETE FROM players.ranked_v1_fixed_team_pulses
          WHERE brawlhalla_id = ${snapshot.brawlhallaId}
            AND (effect_created_at, effect_operation_id::text) <=
              (${effect.effectCreatedAt}::timestamptz, ${effect.effectOperationId ?? effect.operationId}::text)
        `
        if (previous?.player_name && previous.player_name !== snapshot.name) {
          await sql`
            INSERT INTO players.discovery_aliases (brawlhalla_id, normalized_alias, display_alias, observed_at)
            VALUES (${snapshot.brawlhallaId}, ${previous.player_name.toLowerCase()}, ${previous.player_name}, ${observedAt})
            ON CONFLICT (brawlhalla_id, normalized_alias) DO UPDATE
            SET display_alias = EXCLUDED.display_alias, observed_at = EXCLUDED.observed_at
          `
        }

        await Promise.all([
          sql`DELETE FROM players.ranked_legends WHERE brawlhalla_id = ${snapshot.brawlhallaId}`,
          sql`DELETE FROM players.ranked_fixed_teams WHERE brawlhalla_id = ${snapshot.brawlhallaId}`,
          sql`DELETE FROM players.ranked_solo_queue WHERE brawlhalla_id = ${snapshot.brawlhallaId}`,
        ])

        if (snapshot.rankedLegends.length > 0) {
          await sql`
            INSERT INTO players.ranked_legends ${sql(
              snapshot.rankedLegends.map((legend, ordinal) => ({
                brawlhalla_id: snapshot.brawlhallaId,
                ordinal,
                legend_id: legend.legendId,
                legend_name_key: legend.legendNameKey,
                rating: legend.rating,
                peak_rating: legend.peakRating,
                tier: legend.tier,
                wins: legend.wins,
                games: legend.games,
              })),
            )}
          `
        }
        if (snapshot.fixedTeams.length > 0) {
          await sql`
            INSERT INTO players.ranked_fixed_teams ${sql(
              snapshot.fixedTeams.map((team, ordinal) => ({
                brawlhalla_id: snapshot.brawlhallaId,
                ordinal,
                brawlhalla_id_one: team.brawlhallaIdOne,
                brawlhalla_id_two: team.brawlhallaIdTwo,
                team_name: team.teamName,
                rating: team.rating,
                peak_rating: team.peakRating,
                tier: team.tier,
                wins: team.wins,
                games: team.games,
                region: team.region,
                global_rank: team.globalRank,
              })),
            )}
          `
        }
        if (snapshot.soloQueue.length > 0) {
          await sql`
            INSERT INTO players.ranked_solo_queue ${sql(
              snapshot.soloQueue.map((solo, ordinal) => ({
                brawlhalla_id: snapshot.brawlhallaId,
                ordinal,
                second_player_id: 0,
                team_name: solo.teamName,
                rating: solo.rating,
                peak_rating: solo.peakRating,
                tier: solo.tier,
                wins: solo.wins,
                games: solo.games,
                region: solo.region,
                global_rank: solo.globalRank,
              })),
            )}
          `
        }

        if (one.rating > 0) {
          const [last] = await sql<{ rating: number; games: number }[]>`
            SELECT rating, games
            FROM players.ranked_rating_history
            WHERE brawlhalla_id = ${snapshot.brawlhallaId}
              AND history_source = 'v0-player-snapshot'
            ORDER BY recorded_at DESC, source_order DESC NULLS LAST, id DESC
            LIMIT 1
          `
          if (!last || last.rating !== one.rating || last.games !== one.games) {
            await sql`
              INSERT INTO players.ranked_rating_history
                (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at)
              VALUES
                (${snapshot.brawlhallaId}, ${one.rating}, ${one.peakRating}, ${one.tier}, ${one.wins},
                 ${one.games}, ${observedAt})
            `
          }
        }
        return 'applied' as const
      })
    },

    async applyPulse(pulse, effect) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        if (!(await commitInteractiveSection(sql, effect))) return 'lease-lost' as const
        await lockRankedPlayer(sql, pulse.brawlhallaId)

        const [profile] = await sql<
          Array<{
            brawlhalla_id: number
            v0_effect_created_at: string | null
            v0_effect_operation_id: string | null
            pulse_effect_created_at: string | null
            pulse_effect_operation_id: string | null
          }>
        >`
          SELECT profile.brawlhalla_id,
                 to_char(profile.v0_effect_created_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS v0_effect_created_at,
                 profile.v0_effect_operation_id,
                 to_char(pulse.one_vs_one_effect_created_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS pulse_effect_created_at,
                 pulse.one_vs_one_effect_operation_id AS pulse_effect_operation_id
          FROM players.ranked_profiles profile
          LEFT JOIN players.ranked_v1_pulse_state pulse USING (brawlhalla_id)
          WHERE profile.brawlhalla_id = ${pulse.brawlhallaId} AND profile.last_success_at IS NOT NULL
          FOR UPDATE OF profile
        `
        if (!profile) return 'no-op' as const

        const incomingOrder = {
          createdAt: effect.effectCreatedAt,
          operationId: effect.effectOperationId ?? effect.operationId,
        }
        const [existingEffect] = await sql<{ operation_id: string }[]>`
          SELECT operation_id
          FROM players.interactive_refresh_effects
          WHERE operation_id = ${incomingOrder.operationId}::uuid AND section = ${effect.section}
        `
        if (existingEffect) return 'already-applied' as const

        const inserted = await sql<{ operation_id: string }[]>`
          INSERT INTO players.interactive_refresh_effects (operation_id, section, lease_token)
          VALUES (${incomingOrder.operationId}::uuid, ${effect.section}, ${effect.leaseToken})
          ON CONFLICT (operation_id, section) DO NOTHING
          RETURNING operation_id
        `
        if (!inserted[0]) return 'already-applied' as const

        const canonicalOrder = {
          createdAt: profile.v0_effect_created_at,
          operationId: profile.v0_effect_operation_id,
        }
        const previousPulseOrder = {
          createdAt: profile.pulse_effect_created_at,
          operationId: profile.pulse_effect_operation_id,
        }
        const newerThanCanonical = isNewer(incomingOrder, canonicalOrder)
        const oneVsOneApplied =
          pulse.oneVsOne !== null && newerThanCanonical && isNewer(incomingOrder, previousPulseOrder)
        const [clock] = await sql<{ observed_at: Date }[]>`SELECT clock_timestamp() AS observed_at`
        const observedAt = clock.observed_at

        if (oneVsOneApplied && pulse.oneVsOne) {
          const one = pulse.oneVsOne
          await sql`
            INSERT INTO players.ranked_v1_pulse_state
              (brawlhalla_id, checked_at, last_success_at, rating, peak_rating, wins, games,
               one_vs_one_effect_created_at, one_vs_one_effect_operation_id)
            VALUES
              (${pulse.brawlhallaId}, ${observedAt}, ${observedAt}, ${one.rating ?? null},
               ${one.peakRating ?? null}, ${one.wins ?? null}, ${one.games ?? null},
               ${incomingOrder.createdAt}, ${incomingOrder.operationId}::uuid)
            ON CONFLICT (brawlhalla_id) DO UPDATE SET
              checked_at = EXCLUDED.checked_at,
              last_success_at = EXCLUDED.last_success_at,
              rating = COALESCE(EXCLUDED.rating, players.ranked_v1_pulse_state.rating),
              peak_rating = COALESCE(EXCLUDED.peak_rating, players.ranked_v1_pulse_state.peak_rating),
              wins = COALESCE(EXCLUDED.wins, players.ranked_v1_pulse_state.wins),
              games = COALESCE(EXCLUDED.games, players.ranked_v1_pulse_state.games),
              one_vs_one_effect_created_at = EXCLUDED.one_vs_one_effect_created_at,
              one_vs_one_effect_operation_id = EXCLUDED.one_vs_one_effect_operation_id
          `
        }

        const teamResults = newerThanCanonical
          ? await Promise.all(
              pulse.fixedTeams.map(
                (team) => sql<{ brawlhalla_id: number }[]>`
                INSERT INTO players.ranked_v1_fixed_team_pulses
                  (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two, rating, peak_rating, wins, games,
                   effect_created_at, effect_operation_id, observed_at)
                SELECT ${pulse.brawlhallaId}, ${team.brawlhallaIdOne}, ${team.brawlhallaIdTwo},
                       ${team.values.rating ?? null}, ${team.values.peakRating ?? null}, ${team.values.wins ?? null},
                       ${team.values.games ?? null}, ${incomingOrder.createdAt}, ${incomingOrder.operationId}::uuid,
                       ${observedAt}
                FROM players.ranked_fixed_teams canonical
                WHERE canonical.brawlhalla_id = ${pulse.brawlhallaId}
                  AND LEAST(canonical.brawlhalla_id_one, canonical.brawlhalla_id_two) = ${team.brawlhallaIdOne}
                  AND GREATEST(canonical.brawlhalla_id_one, canonical.brawlhalla_id_two) = ${team.brawlhallaIdTwo}
                ON CONFLICT (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two) DO UPDATE SET
                  rating = COALESCE(EXCLUDED.rating, players.ranked_v1_fixed_team_pulses.rating),
                  peak_rating = COALESCE(EXCLUDED.peak_rating, players.ranked_v1_fixed_team_pulses.peak_rating),
                  wins = COALESCE(EXCLUDED.wins, players.ranked_v1_fixed_team_pulses.wins),
                  games = COALESCE(EXCLUDED.games, players.ranked_v1_fixed_team_pulses.games),
                  effect_created_at = EXCLUDED.effect_created_at,
                  effect_operation_id = EXCLUDED.effect_operation_id,
                  observed_at = EXCLUDED.observed_at
                WHERE (EXCLUDED.effect_created_at, EXCLUDED.effect_operation_id::text) >
                  (players.ranked_v1_fixed_team_pulses.effect_created_at,
                   players.ranked_v1_fixed_team_pulses.effect_operation_id::text)
                RETURNING brawlhalla_id
              `,
              ),
            )
          : []
        const fixedTeamApplied = teamResults.some((rows) => rows.length > 0)
        if (fixedTeamApplied && !oneVsOneApplied) {
          await sql`
            INSERT INTO players.ranked_v1_pulse_state (brawlhalla_id, checked_at, last_success_at)
            VALUES (${pulse.brawlhallaId}, ${observedAt}, ${observedAt})
            ON CONFLICT (brawlhalla_id) DO UPDATE SET
              checked_at = EXCLUDED.checked_at,
              last_success_at = EXCLUDED.last_success_at
          `
        }
        if (oneVsOneApplied || fixedTeamApplied) return 'applied' as const
        return !newerThanCanonical || pulse.oneVsOne !== null ? ('stale' as const) : ('no-op' as const)
      })
    },

    close: () => client.end(),
  }
}

export type PostgresRankedPlayers = ReturnType<typeof createPostgresRankedPlayers>
