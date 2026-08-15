import postgres from 'postgres'

const IMPORT_LOCK_KEY = 248_197_200
const DEFAULT_BATCH_SIZE = 1_000

type Sql = ReturnType<typeof postgres>

type ProgressRow = {
  status: LegacyCareerImportResult['status']
  last_player_id: number | null
}

type Reconciliation = {
  sourceRows: number
  archivedRows: number
  importedRows: number
  rejectedRows: number
  sourceExact: boolean
  destinationExact: boolean
  exact: boolean
}

export type LegacyCareerImportResult = {
  status: 'complete' | 'in-progress' | 'blocked'
  checkpoint: number | null
  reconciliation: Reconciliation
}

export type LegacyCareerImportOptions = {
  batchSize?: number
  maxBatches?: number
  legacyWritersQuiesced?: true
}

const SOURCE_SNAPSHOT_SELECT = `
  SELECT source.brawlhalla_id,
         source.stats_last_updated AT TIME ZONE 'UTC' AS observed_at,
         jsonb_build_object(
           'player', jsonb_build_object(
             'name', source.name,
             'stats_last_updated', source.stats_last_updated,
             'xp', source.xp,
             'level', source.level,
             'xp_percentage', source.xp_percentage::double precision,
             'total_games', source.total_games,
             'total_wins', source.total_wins,
             'match_time_total', source.match_time_total,
             'damage_bomb', source.damage_bomb,
             'damage_mine', source.damage_mine,
             'damage_spikeball', source.damage_spikeball,
             'damage_sidekick', source.damage_sidekick,
             'hit_snowball', source.hit_snowball,
             'ko_bomb', source.ko_bomb,
             'ko_mine', source.ko_mine,
             'ko_spikeball', source.ko_spikeball,
             'ko_sidekick', source.ko_sidekick,
             'ko_snowball', source.ko_snowball
           ),
           'guild', (
             SELECT row_to_json(source_clan)::jsonb - 'brawlhalla_id'
             FROM public.player_clan source_clan
             WHERE source_clan.brawlhalla_id = source.brawlhalla_id
           ),
           'legends', COALESCE((
             SELECT jsonb_agg(
               jsonb_set(
                 row_to_json(source_legend)::jsonb - 'brawlhalla_id',
                 '{xp_percentage}',
                 to_jsonb(source_legend.xp_percentage::double precision)
               ) ORDER BY source_legend.legend_id
             )
             FROM public.player_stats_legend source_legend
             WHERE source_legend.brawlhalla_id = source.brawlhalla_id
           ), '[]'::jsonb),
           'weapons', COALESCE((
             SELECT jsonb_agg(row_to_json(source_weapon)::jsonb - 'brawlhalla_id' ORDER BY source_weapon.time_held DESC, source_weapon.weapon)
             FROM public.player_weapon_stat source_weapon
             WHERE source_weapon.brawlhalla_id = source.brawlhalla_id
           ), '[]'::jsonb)
         ) AS snapshot
  FROM public.player source
  WHERE source.stats_last_updated IS NOT NULL`

const VALID_SOURCE_PREDICATE = `
  source.brawlhalla_id > 0
  AND source.name ~ '[^[:space:]]'
  AND source.xp IS NOT NULL AND source.xp >= 0
  AND source.level IS NOT NULL AND source.level >= 0
  AND source.xp_percentage IS NOT NULL AND source.xp_percentage BETWEEN 0 AND 1
  AND source.total_games IS NOT NULL AND source.total_games >= 0
  AND source.total_wins IS NOT NULL AND source.total_wins >= 0 AND source.total_wins <= source.total_games
  AND source.match_time_total IS NOT NULL AND source.match_time_total >= 0
  AND source.damage_bomb IS NOT NULL AND source.damage_bomb >= 0
  AND source.damage_mine IS NOT NULL AND source.damage_mine >= 0
  AND source.damage_spikeball IS NOT NULL AND source.damage_spikeball >= 0
  AND source.damage_sidekick IS NOT NULL AND source.damage_sidekick >= 0
  AND source.hit_snowball IS NOT NULL AND source.hit_snowball >= 0
  AND source.ko_bomb IS NOT NULL AND source.ko_bomb >= 0
  AND source.ko_mine IS NOT NULL AND source.ko_mine >= 0
  AND source.ko_spikeball IS NOT NULL AND source.ko_spikeball >= 0
  AND source.ko_sidekick IS NOT NULL AND source.ko_sidekick >= 0
  AND source.ko_snowball IS NOT NULL AND source.ko_snowball >= 0
  AND NOT EXISTS (
    SELECT 1 FROM public.player_clan guild
    WHERE guild.brawlhalla_id = source.brawlhalla_id
      AND (
        guild.clan_id > 0 AND guild.clan_name ~ '[^[:space:]]'
        AND guild.clan_xp >= 0 AND guild.clan_lifetime_xp >= 0 AND guild.personal_xp >= 0
      ) IS NOT TRUE
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.player_stats_legend legend
    WHERE legend.brawlhalla_id = source.brawlhalla_id
      AND (
        legend.legend_id > 0 AND legend.legend_name_key ~ '[^[:space:]]'
        AND legend.xp >= 0 AND legend.level >= 0 AND legend.xp_percentage BETWEEN 0 AND 1
        AND legend.games >= 0 AND legend.wins >= 0 AND legend.wins <= legend.games
        AND legend.match_time >= 0 AND legend.kos >= 0 AND legend.falls >= 0
        AND legend.suicides >= 0 AND legend.team_kos >= 0
        AND legend.damage_dealt >= 0 AND legend.damage_taken >= 0
        AND legend.damage_unarmed >= 0 AND legend.ko_unarmed >= 0
        AND legend.damage_thrown_item >= 0 AND legend.ko_thrown_item >= 0
        AND legend.damage_gadgets >= 0 AND legend.ko_gadgets >= 0
        AND legend.damage_weapon_one >= 0 AND legend.ko_weapon_one >= 0
        AND legend.time_held_weapon_one >= 0 AND legend.damage_weapon_two >= 0
        AND legend.ko_weapon_two >= 0 AND legend.time_held_weapon_two >= 0
      ) IS NOT TRUE
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.player_weapon_stat weapon
    WHERE weapon.brawlhalla_id = source.brawlhalla_id
      AND (weapon.weapon ~ '[^[:space:]]' AND weapon.time_held >= 0 AND weapon.damage >= 0 AND weapon.kos >= 0)
          IS NOT TRUE
  )`

function validateOptions(options: LegacyCareerImportOptions): { batchSize: number; maxBatches: number } {
  if (options.legacyWritersQuiesced !== true) {
    throw new Error('Legacy Career import requires confirmed quiesced V2 Player writers')
  }
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('Legacy Career import batchSize must be between 1 and 10000')
  }
  if (maxBatches !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('Legacy Career import maxBatches must be a positive integer')
  }
  return { batchSize, maxBatches }
}

async function archiveBatch(sql: Sql, brawlhallaIds: number[]): Promise<void> {
  await sql.unsafe(
    `WITH source_snapshots AS (${SOURCE_SNAPSHOT_SELECT} AND source.brawlhalla_id = ANY($1::integer[]))
     INSERT INTO players.legacy_career_archive
       (brawlhalla_id, observed_at, snapshot, source_checksum)
     SELECT brawlhalla_id, observed_at, snapshot,
            encode(sha256(convert_to(snapshot::text, 'UTF8')), 'hex')
     FROM source_snapshots
     ON CONFLICT DO NOTHING`,
    [brawlhallaIds],
  )
}

async function materializeBatch(sql: Sql, brawlhallaIds: number[]): Promise<void> {
  await sql.unsafe(
    `CREATE TEMP TABLE legacy_career_candidates ON COMMIT DROP AS
     SELECT source.brawlhalla_id
     FROM public.player source
     WHERE source.brawlhalla_id = ANY($1::integer[]) AND ${VALID_SOURCE_PREDICATE}`,
    [brawlhallaIds],
  )

  await sql`
    INSERT INTO players.legacy_career_import_rejections
      (brawlhalla_id, code, evidence, source_checksum)
    SELECT source.brawlhalla_id, 'canonical-constraints',
           jsonb_build_object('observedAt', archive.observed_at), archive.source_checksum
    FROM public.player source
    JOIN players.legacy_career_archive archive USING (brawlhalla_id)
    WHERE source.brawlhalla_id = ANY(${brawlhallaIds}::integer[])
      AND NOT EXISTS (
        SELECT 1 FROM legacy_career_candidates candidate
        WHERE candidate.brawlhalla_id = source.brawlhalla_id
      )
    ON CONFLICT DO NOTHING
  `

  const imported = await sql<{ brawlhalla_id: number }[]>`
    INSERT INTO players.career_profiles AS destination
      (brawlhalla_id, player_name, guild_id, guild_name, checked_at, last_success_at, snapshot_source,
       xp, level, xp_percentage, games, wins, match_time, damage_bomb, damage_mine,
       damage_spikeball, damage_sidekick, snowball_hits, bomb_kos, mine_kos, spikeball_kos,
       sidekick_kos, snowball_kos)
    SELECT source.brawlhalla_id, source.name, guild.clan_id, guild.clan_name,
           archive.observed_at, archive.observed_at, 'legacy-v2',
           source.xp, source.level, source.xp_percentage, source.total_games, source.total_wins,
           source.match_time_total, source.damage_bomb, source.damage_mine, source.damage_spikeball,
           source.damage_sidekick, source.hit_snowball, source.ko_bomb, source.ko_mine,
           source.ko_spikeball, source.ko_sidekick, source.ko_snowball
    FROM legacy_career_candidates candidate
    JOIN public.player source USING (brawlhalla_id)
    JOIN players.legacy_career_archive archive USING (brawlhalla_id)
    LEFT JOIN public.player_clan guild USING (brawlhalla_id)
    ON CONFLICT (brawlhalla_id) DO UPDATE SET
      player_name = EXCLUDED.player_name,
      guild_id = EXCLUDED.guild_id,
      guild_name = EXCLUDED.guild_name,
      checked_at = GREATEST(destination.checked_at, EXCLUDED.checked_at),
      last_success_at = EXCLUDED.last_success_at,
      snapshot_source = EXCLUDED.snapshot_source,
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
    WHERE destination.last_success_at IS NULL
    RETURNING brawlhalla_id
  `
  const importedIds = imported.map(({ brawlhalla_id }) => brawlhalla_id)
  if (importedIds.length === 0) return

  await sql`DELETE FROM players.career_legends WHERE brawlhalla_id = ANY(${importedIds}::integer[])`
  await sql`DELETE FROM players.career_weapons WHERE brawlhalla_id = ANY(${importedIds}::integer[])`
  await sql`
    INSERT INTO players.career_legends
      (brawlhalla_id, ordinal, legend_id, legend_name_key, xp, level, xp_percentage,
       games, wins, match_time, kos, falls, suicides, team_kos, damage_dealt, damage_taken,
       damage_unarmed, ko_unarmed, damage_thrown_item, ko_thrown_item, damage_gadgets, ko_gadgets,
       damage_weapon_one, ko_weapon_one, time_held_weapon_one,
       damage_weapon_two, ko_weapon_two, time_held_weapon_two)
    SELECT legend.brawlhalla_id,
           (row_number() OVER (PARTITION BY legend.brawlhalla_id ORDER BY legend.legend_id) - 1)::integer,
           legend.legend_id, legend.legend_name_key, legend.xp, legend.level, legend.xp_percentage,
           legend.games, legend.wins, legend.match_time, legend.kos, legend.falls, legend.suicides,
           legend.team_kos, legend.damage_dealt, legend.damage_taken, legend.damage_unarmed,
           legend.ko_unarmed, legend.damage_thrown_item, legend.ko_thrown_item, legend.damage_gadgets,
           legend.ko_gadgets, legend.damage_weapon_one, legend.ko_weapon_one, legend.time_held_weapon_one,
           legend.damage_weapon_two, legend.ko_weapon_two, legend.time_held_weapon_two
    FROM public.player_stats_legend legend
    WHERE legend.brawlhalla_id = ANY(${importedIds}::integer[])
  `
  await sql`
    INSERT INTO players.career_weapons (brawlhalla_id, ordinal, weapon, held_time, damage, kos)
    SELECT weapon.brawlhalla_id,
           (row_number() OVER (
             PARTITION BY weapon.brawlhalla_id ORDER BY weapon.time_held DESC, weapon.weapon
           ) - 1)::integer,
           weapon.weapon, weapon.time_held, weapon.damage, weapon.kos
    FROM public.player_weapon_stat weapon
    WHERE weapon.brawlhalla_id = ANY(${importedIds}::integer[])
  `
}

async function progressReconciliation(client: Sql): Promise<Reconciliation> {
  const [counts] = await client<
    Array<{ source_rows: number; archived_rows: number; imported_rows: number; rejected_rows: number }>
  >`
    SELECT (SELECT count(*)::integer FROM public.player WHERE stats_last_updated IS NOT NULL) AS source_rows,
           (SELECT count(*)::integer FROM players.legacy_career_archive) AS archived_rows,
           (SELECT count(*)::integer FROM players.career_profiles WHERE snapshot_source = 'legacy-v2') AS imported_rows,
           (SELECT count(*)::integer FROM players.legacy_career_import_rejections) AS rejected_rows
  `
  return {
    sourceRows: counts?.source_rows ?? 0,
    archivedRows: counts?.archived_rows ?? 0,
    importedRows: counts?.imported_rows ?? 0,
    rejectedRows: counts?.rejected_rows ?? 0,
    sourceExact: false,
    destinationExact: false,
    exact: false,
  }
}

async function reconcile(client: Sql): Promise<Reconciliation> {
  const [source] = await client.unsafe<
    Array<{ source_rows: number; archived_rows: number; source_exact: boolean }>
  >(`WITH source_snapshots AS (${SOURCE_SNAPSHOT_SELECT}),
        checksummed AS (
          SELECT brawlhalla_id, observed_at, snapshot,
                 encode(sha256(convert_to(snapshot::text, 'UTF8')), 'hex') AS source_checksum
          FROM source_snapshots
        )
      SELECT (SELECT count(*)::integer FROM checksummed) AS source_rows,
             (SELECT count(*)::integer FROM players.legacy_career_archive) AS archived_rows,
             NOT EXISTS (
               SELECT 1
               FROM checksummed source
               FULL JOIN players.legacy_career_archive archive USING (brawlhalla_id)
               WHERE source.brawlhalla_id IS NULL OR archive.brawlhalla_id IS NULL
                  OR source.observed_at IS DISTINCT FROM archive.observed_at
                  OR source.snapshot IS DISTINCT FROM archive.snapshot
                  OR source.source_checksum IS DISTINCT FROM archive.source_checksum
                  OR archive.source_checksum <> encode(sha256(convert_to(archive.snapshot::text, 'UTF8')), 'hex')
             ) AS source_exact`)

  const [destination] = await client<
    Array<{ imported_rows: number; rejected_rows: number; destination_exact: boolean }>
  >`
    SELECT
      (SELECT count(*)::integer FROM players.career_profiles WHERE snapshot_source = 'legacy-v2') AS imported_rows,
      (SELECT count(*)::integer FROM players.legacy_career_import_rejections) AS rejected_rows,
      NOT EXISTS (
        SELECT 1
        FROM players.legacy_career_archive archive
        LEFT JOIN players.legacy_career_import_rejections rejection USING (brawlhalla_id)
        LEFT JOIN players.career_profiles profile USING (brawlhalla_id)
        WHERE rejection.brawlhalla_id IS NULL
          AND (profile.brawlhalla_id IS NULL OR profile.last_success_at IS NULL)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM players.legacy_career_import_rejections rejection
        JOIN players.legacy_career_archive archive USING (brawlhalla_id)
        WHERE rejection.code <> 'canonical-constraints'
           OR rejection.source_checksum <> archive.source_checksum
      )
      AND NOT EXISTS (
        SELECT 1
        FROM players.career_profiles profile
        LEFT JOIN players.legacy_career_archive archive USING (brawlhalla_id)
        WHERE profile.snapshot_source = 'legacy-v2'
          AND (
            archive.brawlhalla_id IS NULL
            OR profile.player_name IS DISTINCT FROM archive.snapshot->'player'->>'name'
            OR profile.guild_id IS DISTINCT FROM (archive.snapshot->'guild'->>'clan_id')::integer
            OR profile.guild_name IS DISTINCT FROM archive.snapshot->'guild'->>'clan_name'
            OR profile.last_success_at IS DISTINCT FROM archive.observed_at
            OR profile.checked_at < profile.last_success_at
            OR jsonb_build_array(
              profile.xp, profile.level, profile.xp_percentage, profile.games, profile.wins,
              profile.match_time, profile.damage_bomb, profile.damage_mine, profile.damage_spikeball,
              profile.damage_sidekick, profile.snowball_hits, profile.bomb_kos, profile.mine_kos,
              profile.spikeball_kos, profile.sidekick_kos, profile.snowball_kos
            ) IS DISTINCT FROM jsonb_build_array(
              (archive.snapshot->'player'->>'xp')::integer,
              (archive.snapshot->'player'->>'level')::integer,
              (archive.snapshot->'player'->>'xp_percentage')::double precision,
              (archive.snapshot->'player'->>'total_games')::integer,
              (archive.snapshot->'player'->>'total_wins')::integer,
              (archive.snapshot->'player'->>'match_time_total')::integer,
              (archive.snapshot->'player'->>'damage_bomb')::numeric,
              (archive.snapshot->'player'->>'damage_mine')::numeric,
              (archive.snapshot->'player'->>'damage_spikeball')::numeric,
              (archive.snapshot->'player'->>'damage_sidekick')::numeric,
              (archive.snapshot->'player'->>'hit_snowball')::integer,
              (archive.snapshot->'player'->>'ko_bomb')::integer,
              (archive.snapshot->'player'->>'ko_mine')::integer,
              (archive.snapshot->'player'->>'ko_spikeball')::integer,
              (archive.snapshot->'player'->>'ko_sidekick')::integer,
              (archive.snapshot->'player'->>'ko_snowball')::integer
            )
            OR COALESCE((
              SELECT jsonb_agg(row_to_json(stored_legend)::jsonb - 'brawlhalla_id' - 'ordinal' ORDER BY stored_legend.legend_id)
              FROM players.career_legends stored_legend
              WHERE stored_legend.brawlhalla_id = profile.brawlhalla_id
            ), '[]'::jsonb) IS DISTINCT FROM archive.snapshot->'legends'
            OR COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'weapon', weapon.weapon, 'time_held', weapon.held_time,
                  'damage', weapon.damage, 'kos', weapon.kos
                ) ORDER BY weapon.held_time DESC, weapon.weapon
              )
              FROM players.career_weapons weapon WHERE weapon.brawlhalla_id = profile.brawlhalla_id
            ), '[]'::jsonb) IS DISTINCT FROM archive.snapshot->'weapons'
          )
      ) AS destination_exact
  `

  const sourceExact = source?.source_exact === true
  const destinationExact = destination?.destination_exact === true
  return {
    sourceRows: source?.source_rows ?? 0,
    archivedRows: source?.archived_rows ?? 0,
    importedRows: destination?.imported_rows ?? 0,
    rejectedRows: destination?.rejected_rows ?? 0,
    sourceExact,
    destinationExact,
    exact: sourceExact && destinationExact,
  }
}

export async function importLegacyCareerSnapshots(
  connectionString: string,
  options: LegacyCareerImportOptions = {},
): Promise<LegacyCareerImportResult> {
  const { batchSize, maxBatches } = validateOptions(options)
  const client = postgres(connectionString, { max: 1 })
  let locked = false
  try {
    await client.unsafe("SET TIME ZONE 'UTC'")
    await client`SELECT pg_advisory_lock(${IMPORT_LOCK_KEY})`
    locked = true
    await client.unsafe('SET statement_timeout = 0')

    let [progress] = await client<ProgressRow[]>`
      SELECT status, last_player_id FROM players.legacy_career_import_progress WHERE singleton
    `
    if (!progress) {
      ;[progress] = await client<ProgressRow[]>`
        INSERT INTO players.legacy_career_import_progress (status)
        VALUES ('in-progress')
        RETURNING status, last_player_id
      `
    }
    if (progress.status === 'blocked') {
      const reconciliation = await reconcile(client)
      if (!reconciliation.exact) {
        return { status: 'blocked', checkpoint: progress.last_player_id, reconciliation }
      }
      await client`
        UPDATE players.legacy_career_import_progress
        SET status = 'complete', completed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE singleton
      `
      return { status: 'complete', checkpoint: null, reconciliation }
    }

    let cursor = progress.last_player_id
    let batches = 0
    let completed = progress.status === 'complete'
    while (!completed && batches < maxBatches) {
      const batch = await client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        await sql.unsafe(
          'LOCK TABLE public.player, public.player_clan, public.player_stats_legend, public.player_weapon_stat IN SHARE MODE',
        )
        const rows = await sql<{ brawlhalla_id: number }[]>`
          SELECT brawlhalla_id FROM public.player
          WHERE stats_last_updated IS NOT NULL
            AND (${cursor}::integer IS NULL OR brawlhalla_id > ${cursor})
          ORDER BY brawlhalla_id
          LIMIT ${batchSize}
        `
        if (rows.length === 0) {
          await sql`
            UPDATE players.legacy_career_import_progress
            SET status = 'complete', completed_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE singleton
          `
          return { complete: true as const, cursor }
        }
        const ids = rows.map(({ brawlhalla_id }) => brawlhalla_id)
        await archiveBatch(sql, ids)
        await materializeBatch(sql, ids)
        const nextCursor = ids.at(-1) as number
        await sql`
          UPDATE players.legacy_career_import_progress
          SET last_player_id = ${nextCursor}, updated_at = clock_timestamp()
          WHERE singleton
        `
        return { complete: false as const, cursor: nextCursor }
      })
      cursor = batch.cursor
      completed = batch.complete
      batches += 1
    }

    if (!completed) {
      return { status: 'in-progress', checkpoint: cursor, reconciliation: await progressReconciliation(client) }
    }

    const reconciliation = await reconcile(client)
    if (!reconciliation.exact) {
      await client`
        UPDATE players.legacy_career_import_progress
        SET status = 'blocked', completed_at = NULL, updated_at = clock_timestamp()
        WHERE singleton
      `
      return { status: 'blocked', checkpoint: cursor, reconciliation }
    }
    return { status: 'complete', checkpoint: null, reconciliation }
  } finally {
    if (locked) await client`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`
    await client.end()
  }
}
