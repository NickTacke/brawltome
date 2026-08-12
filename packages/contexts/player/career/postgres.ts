import postgres from 'postgres'
import { CAREER_FRESHNESS_SECONDS, type CareerPlayerProfile, type CareerPlayerQueries, careerFreshness } from './model'
import type { V0CareerSnapshot } from './source'

export type CanonicalCareerEffect = {
  operationId: string
  effectOperationId?: string
  leaseOwner: string
  leaseToken: number
  section: 'stats'
}

type FencedResult = 'applied' | 'already-applied' | 'lease-lost'
type Sql = ReturnType<typeof postgres>

type ProfileRow = {
  brawlhalla_id: number
  checked_at: Date
  last_success_at: Date | null
  xp: number | null
  level: number | null
  xp_percentage: number | null
  games: number | null
  wins: number | null
  match_time: number | null
  damage_bomb: string | null
  damage_mine: string | null
  damage_spikeball: string | null
  damage_sidekick: string | null
  snowball_hits: number | null
  bomb_kos: number | null
  mine_kos: number | null
  spikeball_kos: number | null
  sidekick_kos: number | null
  snowball_kos: number | null
}

type LegendRow = {
  legend_id: number
  legend_name_key: string
  xp: number
  level: number
  xp_percentage: number
  games: number
  wins: number
  match_time: number
  kos: number
  falls: number
  suicides: number
  team_kos: number
  damage_dealt: string
  damage_taken: string
  damage_unarmed: string
  ko_unarmed: number
  damage_thrown_item: string
  ko_thrown_item: number
  damage_gadgets: string
  ko_gadgets: number
  damage_weapon_one: string
  ko_weapon_one: number
  time_held_weapon_one: number
  damage_weapon_two: string
  ko_weapon_two: number
  time_held_weapon_two: number
}

type WeaponRow = {
  weapon: string
  held_time: number
  damage: string
  kos: number
}

async function acquireLease(sql: Sql, effect: CanonicalCareerEffect): Promise<boolean> {
  const [lease] = await sql<{ active: boolean }[]>`
    SELECT refresh_operations.acquire_active_lease(
      ${effect.operationId}::uuid,
      ${effect.leaseOwner},
      ${effect.leaseToken}
    ) AS active
  `
  return lease?.active === true
}

async function commitInteractiveSection(sql: Sql, effect: CanonicalCareerEffect): Promise<boolean> {
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

export function createPostgresCareerPlayers(
  connectionString: string,
  options: { now?: () => Date } = {},
): CareerPlayerQueries & {
  referenceById(
    brawlhallaId: number,
  ): Promise<{ brawlhallaId: number; name: string; bestLegendNameKey: string | null } | null>
  mainLegendById(brawlhallaId: number): Promise<{ legendId: number; legendNameKey: string } | null>
  recordChecked(brawlhallaId: number, effect: CanonicalCareerEffect): Promise<FencedResult>
  applySnapshot(snapshot: V0CareerSnapshot, effect: CanonicalCareerEffect): Promise<FencedResult>
  close(): Promise<void>
} {
  const client = postgres(connectionString)
  const now = options.now ?? (() => new Date())

  return {
    async referenceById(brawlhallaId) {
      const [profile] = await client<{ brawlhalla_id: number; player_name: string; legend_name_key: string | null }[]>`
        SELECT profile.brawlhalla_id, profile.player_name, legend.legend_name_key
        FROM players.career_profiles profile
        LEFT JOIN LATERAL (
          SELECT legend_name_key
          FROM players.career_legends
          WHERE brawlhalla_id = profile.brawlhalla_id
          ORDER BY xp DESC, level DESC, ordinal ASC
          LIMIT 1
        ) legend ON true
        WHERE profile.brawlhalla_id = ${brawlhallaId} AND profile.last_success_at IS NOT NULL
      `
      return profile
        ? {
            brawlhallaId: profile.brawlhalla_id,
            name: profile.player_name,
            bestLegendNameKey: profile.legend_name_key,
          }
        : null
    },

    async mainLegendById(brawlhallaId) {
      const [legend] = await client<{ legend_id: number; legend_name_key: string }[]>`
        SELECT legend_id, legend_name_key
        FROM players.career_legends
        WHERE brawlhalla_id = ${brawlhallaId}
          AND EXISTS (
            SELECT 1 FROM players.career_profiles
            WHERE brawlhalla_id = ${brawlhallaId} AND last_success_at IS NOT NULL
          )
        ORDER BY xp DESC, level DESC, ordinal ASC
        LIMIT 1
      `
      return legend ? { legendId: legend.legend_id, legendNameKey: legend.legend_name_key } : null
    },

    async byId(brawlhallaId) {
      return client.begin('isolation level repeatable read read only', async (transaction) => {
        const sql = transaction as unknown as Sql
        const [profile] = await sql<ProfileRow[]>`
          SELECT brawlhalla_id, checked_at, last_success_at, xp, level, xp_percentage, games, wins,
                 match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
                 snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos
          FROM players.career_profiles
          WHERE brawlhalla_id = ${brawlhallaId}
        `
        if (!profile) return null

        const freshness = careerFreshness(profile.last_success_at, now())
        if (!profile.last_success_at) {
          return {
            brawlhallaId,
            checkedAt: profile.checked_at,
            lastSuccessAt: null,
            freshness,
            freshForSeconds: CAREER_FRESHNESS_SECONDS,
            snapshot: null,
          }
        }

        const [legends, weapons] = await Promise.all([
          sql<LegendRow[]>`
            SELECT legend_id, legend_name_key, xp, level, xp_percentage, games, wins, match_time,
                   kos, falls, suicides, team_kos, damage_dealt, damage_taken, damage_unarmed,
                   ko_unarmed, damage_thrown_item, ko_thrown_item, damage_gadgets, ko_gadgets,
                   damage_weapon_one, ko_weapon_one, time_held_weapon_one, damage_weapon_two,
                   ko_weapon_two, time_held_weapon_two
            FROM players.career_legends
            WHERE brawlhalla_id = ${brawlhallaId}
            ORDER BY ordinal
          `,
          sql<WeaponRow[]>`
            SELECT weapon, held_time, damage, kos
            FROM players.career_weapons
            WHERE brawlhalla_id = ${brawlhallaId}
            ORDER BY ordinal
          `,
        ])

        return {
          brawlhallaId,
          checkedAt: profile.checked_at,
          lastSuccessAt: profile.last_success_at,
          freshness,
          freshForSeconds: CAREER_FRESHNESS_SECONDS,
          snapshot: {
            account: {
              xp: profile.xp as number,
              level: profile.level as number,
              xpPercentage: profile.xp_percentage as number,
            },
            combat: {
              games: profile.games as number,
              wins: profile.wins as number,
              matchTime: profile.match_time as number,
              damageBomb: profile.damage_bomb as string,
              damageMine: profile.damage_mine as string,
              damageSpikeball: profile.damage_spikeball as string,
              damageSidekick: profile.damage_sidekick as string,
              snowballHits: profile.snowball_hits as number,
              bombKos: profile.bomb_kos as number,
              mineKos: profile.mine_kos as number,
              spikeballKos: profile.spikeball_kos as number,
              sidekickKos: profile.sidekick_kos as number,
              snowballKos: profile.snowball_kos as number,
            },
            legends: legends.map((legend) => ({
              legendId: legend.legend_id,
              legendNameKey: legend.legend_name_key,
              xp: legend.xp,
              level: legend.level,
              xpPercentage: legend.xp_percentage,
              games: legend.games,
              wins: legend.wins,
              matchTime: legend.match_time,
              kos: legend.kos,
              falls: legend.falls,
              suicides: legend.suicides,
              teamKos: legend.team_kos,
              damageDealt: legend.damage_dealt,
              damageTaken: legend.damage_taken,
              unarmed: { damage: legend.damage_unarmed, kos: legend.ko_unarmed },
              thrownItem: { damage: legend.damage_thrown_item, kos: legend.ko_thrown_item },
              gadgets: { damage: legend.damage_gadgets, kos: legend.ko_gadgets },
              weaponOne: {
                damage: legend.damage_weapon_one,
                kos: legend.ko_weapon_one,
                heldTime: legend.time_held_weapon_one,
              },
              weaponTwo: {
                damage: legend.damage_weapon_two,
                kos: legend.ko_weapon_two,
                heldTime: legend.time_held_weapon_two,
              },
            })),
            weapons: weapons.map((weapon) => ({
              weapon: weapon.weapon,
              heldTime: weapon.held_time,
              damage: weapon.damage,
              kos: weapon.kos,
            })),
          },
        } satisfies CareerPlayerProfile
      })
    },

    async recordChecked(brawlhallaId, effect) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        if (!(await acquireLease(sql, effect))) return 'lease-lost' as const
        await sql`
          INSERT INTO players.career_profiles (brawlhalla_id, checked_at)
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
          INSERT INTO players.interactive_refresh_effects (operation_id, section, lease_token, effect_version)
          VALUES (${effect.effectOperationId ?? effect.operationId}::uuid, ${effect.section}, ${effect.leaseToken}, 1)
          ON CONFLICT (operation_id, section) DO UPDATE SET
            lease_token = EXCLUDED.lease_token,
            effect_version = EXCLUDED.effect_version
          WHERE players.interactive_refresh_effects.effect_version IS NULL
          RETURNING operation_id
        `
        if (!inserted[0]) return 'already-applied' as const

        const [clock] = await sql<{ observed_at: Date }[]>`SELECT clock_timestamp() AS observed_at`
        const observedAt = clock.observed_at
        const { account, combat } = snapshot
        await sql`
          INSERT INTO players.career_profiles
            (brawlhalla_id, player_name, checked_at, last_success_at, xp, level, xp_percentage,
             games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
             snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
          VALUES
            (${snapshot.brawlhallaId}, ${snapshot.name}, ${observedAt}, ${observedAt}, ${account.xp},
             ${account.level}, ${account.xpPercentage}, ${combat.games}, ${combat.wins}, ${combat.matchTime},
             ${combat.damageBomb}, ${combat.damageMine}, ${combat.damageSpikeball}, ${combat.damageSidekick},
             ${combat.snowballHits}, ${combat.bombKos}, ${combat.mineKos}, ${combat.spikeballKos},
             ${combat.sidekickKos}, ${combat.snowballKos})
          ON CONFLICT (brawlhalla_id) DO UPDATE SET
            player_name = EXCLUDED.player_name,
            checked_at = EXCLUDED.checked_at,
            last_success_at = EXCLUDED.last_success_at,
            xp = EXCLUDED.xp,
            level = EXCLUDED.level,
            xp_percentage = EXCLUDED.xp_percentage,
            games = EXCLUDED.games,
            wins = EXCLUDED.wins,
            match_time = EXCLUDED.match_time,
            damage_bomb = EXCLUDED.damage_bomb,
            damage_mine = EXCLUDED.damage_mine,
            damage_spikeball = EXCLUDED.damage_spikeball,
            damage_sidekick = EXCLUDED.damage_sidekick,
            snowball_hits = EXCLUDED.snowball_hits,
            bomb_kos = EXCLUDED.bomb_kos,
            mine_kos = EXCLUDED.mine_kos,
            spikeball_kos = EXCLUDED.spikeball_kos,
            sidekick_kos = EXCLUDED.sidekick_kos,
            snowball_kos = EXCLUDED.snowball_kos
        `

        await Promise.all([
          sql`DELETE FROM players.career_legends WHERE brawlhalla_id = ${snapshot.brawlhallaId}`,
          sql`DELETE FROM players.career_weapons WHERE brawlhalla_id = ${snapshot.brawlhallaId}`,
        ])

        if (snapshot.legends.length > 0) {
          await sql`
            INSERT INTO players.career_legends ${sql(
              snapshot.legends.map((legend, ordinal) => ({
                brawlhalla_id: snapshot.brawlhallaId,
                ordinal,
                legend_id: legend.legendId,
                legend_name_key: legend.legendNameKey,
                xp: legend.xp,
                level: legend.level,
                xp_percentage: legend.xpPercentage,
                games: legend.games,
                wins: legend.wins,
                match_time: legend.matchTime,
                kos: legend.kos,
                falls: legend.falls,
                suicides: legend.suicides,
                team_kos: legend.teamKos,
                damage_dealt: legend.damageDealt,
                damage_taken: legend.damageTaken,
                damage_unarmed: legend.unarmed.damage,
                ko_unarmed: legend.unarmed.kos,
                damage_thrown_item: legend.thrownItem.damage,
                ko_thrown_item: legend.thrownItem.kos,
                damage_gadgets: legend.gadgets.damage,
                ko_gadgets: legend.gadgets.kos,
                damage_weapon_one: legend.weaponOne.damage,
                ko_weapon_one: legend.weaponOne.kos,
                time_held_weapon_one: legend.weaponOne.heldTime,
                damage_weapon_two: legend.weaponTwo.damage,
                ko_weapon_two: legend.weaponTwo.kos,
                time_held_weapon_two: legend.weaponTwo.heldTime,
              })),
            )}
          `
        }
        if (snapshot.weapons.length > 0) {
          await sql`
            INSERT INTO players.career_weapons ${sql(
              snapshot.weapons.map((weapon, ordinal) => ({
                brawlhalla_id: snapshot.brawlhallaId,
                ordinal,
                weapon: weapon.weapon,
                held_time: weapon.heldTime,
                damage: weapon.damage,
                kos: weapon.kos,
              })),
            )}
          `
        }
        return 'applied' as const
      })
    },

    close: () => client.end(),
  }
}

export type PostgresCareerPlayers = ReturnType<typeof createPostgresCareerPlayers>
