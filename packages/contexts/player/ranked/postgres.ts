import postgres from 'postgres'
import {
  type MainLegend,
  RANKED_FRESHNESS_SECONDS,
  type RankedPlayerProfile,
  type RankedPlayerQueries,
  rankedFreshness,
} from './model'
import type { V0RankedSnapshot } from './source'

export type CanonicalRankedEffect = {
  operationId: string
  leaseOwner: string
  leaseToken: number
  section: 'ranked'
}

type FencedResult = 'applied' | 'already-applied' | 'lease-lost'
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
}

type ValuesRow = {
  rating: number
  peak_rating: number
  tier: string
  wins: number
  games: number
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

export function createPostgresRankedPlayers(
  connectionString: string,
  options: {
    resolveCareerMainLegend?: CareerMainLegendResolver
    now?: () => Date
  } = {},
): RankedPlayerQueries & {
  referenceById(brawlhallaId: number): Promise<{ brawlhallaId: number; name: string } | null>
  recordChecked(brawlhallaId: number, effect: CanonicalRankedEffect): Promise<FencedResult>
  applySnapshot(snapshot: V0RankedSnapshot, effect: CanonicalRankedEffect): Promise<FencedResult>
  close(): Promise<void>
} {
  const client = postgres(connectionString)
  const now = options.now ?? (() => new Date())

  return {
    async referenceById(brawlhallaId) {
      const [profile] = await client<{ brawlhalla_id: number; player_name: string }[]>`
        SELECT brawlhalla_id, player_name
        FROM players.ranked_profiles
        WHERE brawlhalla_id = ${brawlhallaId} AND last_success_at IS NOT NULL
      `
      return profile ? { brawlhallaId: profile.brawlhalla_id, name: profile.player_name } : null
    },

    async byId(brawlhallaId) {
      return client.begin('isolation level repeatable read read only', async (transaction) => {
        const sql = transaction as unknown as Sql
        const [profile] = await sql<ProfileRow[]>`
        SELECT brawlhalla_id, checked_at, last_success_at, region, rating, peak_rating, tier,
               wins, games, global_rank, region_rank, ranked_main_legend_id, ranked_main_legend_name_key
        FROM players.ranked_profiles
        WHERE brawlhalla_id = ${brawlhallaId}
      `
        if (!profile) return null

        const freshness = rankedFreshness(profile.last_success_at, now())
        if (!profile.last_success_at) {
          return {
            brawlhallaId,
            checkedAt: profile.checked_at,
            lastSuccessAt: null,
            freshness,
            freshForSeconds: RANKED_FRESHNESS_SECONDS,
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
              ValuesRow & {
                brawlhalla_id_one: number
                brawlhalla_id_two: number
                team_name: string
                region: string
                global_rank: number | null
              }
            >
          >`
          SELECT brawlhalla_id_one, brawlhalla_id_two, team_name, rating, peak_rating,
                 tier, wins, games, region, global_rank
          FROM players.ranked_fixed_teams
          WHERE brawlhalla_id = ${brawlhallaId}
          ORDER BY ordinal
        `,
          sql<
            Array<ValuesRow & { second_player_id: 0; team_name: string; region: string; global_rank: number | null }>
          >`
          SELECT second_player_id, team_name, rating, peak_rating, tier, wins, games, region, global_rank
          FROM players.ranked_solo_queue
          WHERE brawlhalla_id = ${brawlhallaId}
          ORDER BY ordinal
        `,
          sql<Array<ValuesRow & { recorded_at: Date }>>`
          SELECT rating, peak_rating, tier, wins, games, recorded_at
          FROM players.ranked_rating_history
          WHERE brawlhalla_id = ${brawlhallaId}
          ORDER BY recorded_at DESC, id DESC
          LIMIT 365
        `,
        ])

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

        return {
          brawlhallaId,
          checkedAt: profile.checked_at,
          lastSuccessAt: profile.last_success_at,
          freshness,
          freshForSeconds: RANKED_FRESHNESS_SECONDS,
          snapshot: {
            oneVsOne: {
              rating: profile.rating as number,
              peakRating: profile.peak_rating as number,
              tier: profile.tier as string,
              wins: profile.wins as number,
              games: profile.games as number,
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
              ...values(row),
            })),
            soloQueue: soloRows.map((row) => ({
              secondPlayerId: row.second_player_id,
              teamName: row.team_name,
              region: row.region,
              globalRank: row.global_rank,
              ...values(row),
            })),
            ratingHistory: historyRows.map((row) => ({ ...values(row), recordedAt: row.recorded_at })),
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

    async applySnapshot(snapshot, effect) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        if (!(await commitInteractiveSection(sql, effect))) return 'lease-lost' as const
        const inserted = await sql<{ operation_id: string }[]>`
          INSERT INTO players.interactive_refresh_effects (operation_id, section, lease_token)
          VALUES (${effect.operationId}::uuid, ${effect.section}, ${effect.leaseToken})
          ON CONFLICT (operation_id, section) DO NOTHING
          RETURNING operation_id
        `
        if (!inserted[0]) return 'already-applied' as const

        const [clock] = await sql<{ observed_at: Date }[]>`SELECT clock_timestamp() AS observed_at`
        const observedAt = clock.observed_at
        const one = snapshot.oneVsOne
        await sql`
          INSERT INTO players.ranked_profiles
            (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating,
             tier, wins, games, global_rank, region_rank, ranked_main_legend_id,
             ranked_main_legend_name_key)
          VALUES
            (${snapshot.brawlhallaId}, ${snapshot.name}, ${observedAt}, ${observedAt}, ${one.region},
             ${one.rating}, ${one.peakRating}, ${one.tier}, ${one.wins}, ${one.games}, ${one.globalRank},
             ${one.regionRank}, ${snapshot.rankedMainLegend?.legendId ?? null},
             ${snapshot.rankedMainLegend?.legendNameKey ?? null})
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
            ranked_main_legend_name_key = EXCLUDED.ranked_main_legend_name_key
        `

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
            ORDER BY recorded_at DESC, id DESC
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

    close: () => client.end(),
  }
}

export type PostgresRankedPlayers = ReturnType<typeof createPostgresRankedPlayers>
