import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { accountsMigrationInventory } from '@brawltome/accounts/composition'
import { clanMigrationInventory } from '@brawltome/clan/composition'
import { discoveryMigrationInventory } from '@brawltome/discovery/composition'
import { playerMigrationInventory } from '@brawltome/player/composition'
import { rankingMigrationInventory } from '@brawltome/ranking/composition'
import { refreshOperationsMigrationInventory } from '@brawltome/refresh-operations/composition'
import { replayAnalysisMigrationInventory } from '@brawltome/replay-analysis/composition'
import { requestAdmissionMigrationInventory } from '@brawltome/request-admission/composition'
import { statisticsMigrationInventory } from '@brawltome/statistics/composition'
import postgres from 'postgres'
import { globalMigrationInventory } from '../src/inventories'
import { type Migration, checksumSql } from '../src/plan'
import { migratePostgres } from '../src/postgres'

const connectionString = process.env.DATABASE_URL

const deployedGlobalHistory = [
  ['players/0001', '9fff6573583618708c9c931a59389543124d9848ac747012682ea278eda23bc4'],
  ['players/0002', 'fc28d5cfebc3578e98941194f7d3a82f49acb66048c522c60579bc5952b8d813'],
  ['players/0003', 'dfad48739d880c7e48b92d47968549ffa18800969d64709b4700e1a1bddf870c'],
  ['refresh-operations/0001', '1f32e6322472955d54595762e3089c9adb07ec0727270cbbdd0c5feb5404e4f2'],
  ['refresh-operations/0002', 'eeb157f26cb2e5a263953f7405ff908beaa65b3dd368a73d4b480e822b3a3dbd'],
  ['refresh-operations/0003', '4f5d57a9827939268a0bea1574e9724cc37e93904582288afdfd7d862e639cf2'],
  ['refresh-operations/0004', '34ab6f76aa894f80e8f9316742b6c8a23e44f816768e5967c887817dc1a8c7bc'],
  ['refresh-operations/0005', 'cc91f02a20ef0e3489a981552e71c01aedbbe19c7facf24e3c420d4ab2622abb'],
  ['refresh-operations/0006', '9cedc673d6c7508bcb157585e05c7f74854f26b7527f78f1fb58cc72346d7b23'],
  ['request-admission/0001', 'c5a231d4c495e6fd0077527ca681fc0b9d87acc19ee775b141f6dace81783fff'],
  ['request-admission/0002', 'dc0ce038a0793f9f61a08f3fd6faba4385a3721910798ec266cc7a94b7666e37'],
  ['accounts/0001', '35221acf208c770f80f551d62a6c7698e4a3c03fb4aa5c87b83ab9c442232354'],
  ['accounts/0002', '0267bc15fea9cf27bf8d08434e9c7cb3f8c054beb9274619a770236f116bf99c'],
  ['rankings/0001', 'd3c91ddf8a99e6a5a39b88eaad3813f9e65c693346fe1bf054b5fe6f4901b701'],
  ['clans/0001', 'f258dd4e3e46c8bcaa917f3f42a3d4a9925963374453e7c7c7b70565ea502700'],
  ['refresh-operations/0007', '7e8aafa5721bef24c28a00dfcee3d39d6cc90aecbdc77abf70401cb5cb8cf6e7'],
  ['refresh-operations/0008', '4155f341183e7f277b73a12a38eb24b219193a634cb253b583faf875c0c7a282'],
  ['accounts/0003', '3b6a89bd5b60420ac04471559c2b8a8e27495b52135e176438910de3611696a3'],
  ['refresh-operations/0009', '8c91d27975f4f672485a354c6486980f5aaac597ef9d29662b7b9476d6b3dc60'],
  ['rankings/0002', 'ad02e3418fd523a88541aec0c6b1d0c1c38f87b3c4a20bd76f5dfb64e3bbb9bd'],
  ['players/0004', '52476706ae067d30e57b1b33beb80254b511adbffb1b4f7c74d1371f5931df7c'],
  ['players/0005', '4d2f348303b8be6e467479c9f4cbb00bdbb343f643c04ae408fd218fdfa9e1c4'],
  ['refresh-operations/0010', '951803dec9356108ebc1f786b55816a1baa10f118c4dc014b45ccd49f7c3dfbd'],
  ['discovery/0001', 'c3b9e880208831ee1be1fe8a27c733f0ec17e4df03435e39d811d264e9b51707'],
  ['accounts/0004', 'fb0dd41d2bb7175980963b13c4e809617cdd267dfe72170df594665ced443f33'],
] as const

const deployedPulseGlobalHistory = [
  ...deployedGlobalHistory,
  ['players/0006', '8416e791b342e49758d657379e2943e08b55d3d3295652ea3175908fa5eb81d6'],
  ['refresh-operations/0011', '538e16caf6c1ae189d2610648055c26964f153d66c4d2502611848fdfeaf7443'],
] as const

const deployedMonitoringGlobalHistory = [
  ...deployedPulseGlobalHistory,
  ['refresh-operations/0012', '46b5a4dcb1b6f5b324492bf46f06338febdc6956497fbd796309b161c205d15b'],
] as const

const deployedPrePlayersImportGlobalHistory = [
  ...deployedMonitoringGlobalHistory,
  ['clans/0002', 'a2a148ba624a2b44f8efbebc8fd6026ef5e6fabbce7870acab7acb43e6353037'],
  ['discovery/0002', '4c220d9f563c8164f4d4a38c2eb910f554a050eac2f11fc7222b24da33c45a42'],
  ['refresh-operations/0013', '690956f941c78e993df758033df5574b06ba89ada6ff6e2f499ef804b5207c00'],
  ['statistics/0001', '3eaeb7aeeffdcd02b673cc8ec595f7008be756d330db0aaf4427ebb3511c4298'],
  ['refresh-operations/0014', '362cad045add7a167396a82fb703ddf45fb8de7ee1c3f641cdf2b887c72fe6b1'],
  ['accounts/0005', '979f9c419e6d6ec189ad92c7cf1385002fd30584285aab2220fd42560ef8c8c5'],
] as const

describe.skipIf(!connectionString)('PostgreSQL migration runner', () => {
  test('inventories append current capability migrations without changing deployed history', () => {
    expect(accountsMigrationInventory.map(({ identity }) => identity)).toEqual([
      'accounts/0001',
      'accounts/0002',
      'accounts/0003',
      'accounts/0004',
      'accounts/0005',
      'accounts/0006',
      'accounts/0007',
    ])
    expect(playerMigrationInventory.map(({ identity }): string => identity)).toEqual([
      'players/0001',
      'players/0002',
      'players/0003',
      'players/0004',
      'players/0005',
      'players/0006',
      'players/0007',
      'players/0008',
      'players/0009',
      'players/0010',
      'players/0011',
      'players/0012',
      'players/0013',
    ])
    expect(clanMigrationInventory.map(({ identity }) => identity)).toEqual([
      'clans/0001',
      'clans/0002',
      'clans/0003',
      'clans/0004',
    ])
    expect(rankingMigrationInventory.map(({ identity }) => identity)).toEqual([
      'rankings/0001',
      'rankings/0002',
      'rankings/0003',
      'rankings/0004',
      'rankings/0005',
      'rankings/0006',
    ])
    expect(globalMigrationInventory.slice(-6).map(({ identity }): string => identity)).toEqual([
      'players/0010',
      'clans/0004',
      'players/0011',
      'players/0012',
      'players/0013',
      'replay-analysis/0001',
    ])
    expect(discoveryMigrationInventory.map(({ identity }) => identity)).toEqual([
      'discovery/0001',
      'discovery/0002',
      'discovery/0003',
    ])
    expect(refreshOperationsMigrationInventory.map(({ identity }) => identity)).toEqual([
      'refresh-operations/0001',
      'refresh-operations/0002',
      'refresh-operations/0003',
      'refresh-operations/0004',
      'refresh-operations/0005',
      'refresh-operations/0006',
      'refresh-operations/0007',
      'refresh-operations/0008',
      'refresh-operations/0009',
      'refresh-operations/0010',
      'refresh-operations/0011',
      'refresh-operations/0012',
      'refresh-operations/0013',
      'refresh-operations/0014',
      'refresh-operations/0015',
      'refresh-operations/0016',
    ])
    expect(statisticsMigrationInventory.map(({ identity }) => identity)).toEqual([
      'statistics/0001',
      'statistics/0002',
      'statistics/0003',
      'statistics/0004',
    ])
  })

  test('preserves the complete pre-Clans global history as an applied prefix', async () => {
    const oldGlobalInventory = [
      ...playerMigrationInventory.slice(0, 3),
      ...refreshOperationsMigrationInventory.slice(0, 6),
      ...requestAdmissionMigrationInventory.slice(0, 2),
      ...accountsMigrationInventory.slice(0, 2),
      rankingMigrationInventory[0],
    ]
    expect(globalMigrationInventory.slice(0, oldGlobalInventory.length)).toEqual(oldGlobalInventory)
    expect(globalMigrationInventory.slice(oldGlobalInventory.length)).toEqual([
      clanMigrationInventory[0],
      refreshOperationsMigrationInventory[6],
      refreshOperationsMigrationInventory[7],
      accountsMigrationInventory[2],
      refreshOperationsMigrationInventory[8],
      rankingMigrationInventory[1],
      playerMigrationInventory[3],
      playerMigrationInventory[4],
      refreshOperationsMigrationInventory[9],
      discoveryMigrationInventory[0],
      accountsMigrationInventory[3],
      playerMigrationInventory[5],
      refreshOperationsMigrationInventory[10],
      refreshOperationsMigrationInventory[11],
      clanMigrationInventory[1],
      discoveryMigrationInventory[1],
      refreshOperationsMigrationInventory[12],
      statisticsMigrationInventory[0],
      refreshOperationsMigrationInventory[13],
      accountsMigrationInventory[4],
      playerMigrationInventory[6],
      statisticsMigrationInventory[1],
      refreshOperationsMigrationInventory[14],
      clanMigrationInventory[2],
      rankingMigrationInventory[2],
      accountsMigrationInventory[5],
      statisticsMigrationInventory[2],
      refreshOperationsMigrationInventory[15],
      statisticsMigrationInventory[3],
      requestAdmissionMigrationInventory[2],
      discoveryMigrationInventory[2],
      accountsMigrationInventory[6],
      rankingMigrationInventory[3],
      rankingMigrationInventory[4],
      playerMigrationInventory[7],
      rankingMigrationInventory[5],
      playerMigrationInventory[8],
      playerMigrationInventory[9],
      clanMigrationInventory[3],
      playerMigrationInventory[10],
      playerMigrationInventory[11],
      playerMigrationInventory[12],
      replayAnalysisMigrationInventory[0],
    ])

    const databaseName = `brawltome_clan_prefix_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      expect(await migratePostgres(databaseUrl.toString(), oldGlobalInventory)).toBe(oldGlobalInventory.length)
      expect(await migratePostgres(databaseUrl.toString(), globalMigrationInventory)).toBe(
        globalMigrationInventory.length - oldGlobalInventory.length,
      )
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 15_000)

  test('preserves the fixed 34-row pre-Players-import history and appends later migrations', async () => {
    expect(
      globalMigrationInventory
        .slice(0, deployedPrePlayersImportGlobalHistory.length)
        .map(({ identity, checksum }) => [identity, checksum]),
    ).toEqual(deployedPrePlayersImportGlobalHistory.map((entry) => [...entry]))
    const oldGlobalInventory = globalMigrationInventory.slice(0, deployedPrePlayersImportGlobalHistory.length)
    expect(deployedGlobalHistory).toHaveLength(25)
    expect(deployedPulseGlobalHistory).toHaveLength(27)
    expect(deployedMonitoringGlobalHistory).toHaveLength(28)
    expect(deployedPrePlayersImportGlobalHistory).toHaveLength(34)
    expect(globalMigrationInventory).toHaveLength(57)
    expect(globalMigrationInventory.slice(deployedPrePlayersImportGlobalHistory.length)).toEqual([
      playerMigrationInventory[6],
      statisticsMigrationInventory[1],
      refreshOperationsMigrationInventory[14],
      clanMigrationInventory[2],
      rankingMigrationInventory[2],
      accountsMigrationInventory[5],
      statisticsMigrationInventory[2],
      refreshOperationsMigrationInventory[15],
      statisticsMigrationInventory[3],
      requestAdmissionMigrationInventory[2],
      discoveryMigrationInventory[2],
      accountsMigrationInventory[6],
      rankingMigrationInventory[3],
      rankingMigrationInventory[4],
      playerMigrationInventory[7],
      rankingMigrationInventory[5],
      playerMigrationInventory[8],
      playerMigrationInventory[9],
      clanMigrationInventory[3],
      playerMigrationInventory[10],
      playerMigrationInventory[11],
      playerMigrationInventory[12],
      replayAnalysisMigrationInventory[0],
    ])

    const databaseName = `brawltome_deployed_prefix_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      expect(await migratePostgres(databaseUrl.toString(), oldGlobalInventory)).toBe(oldGlobalInventory.length)
      expect(await migratePostgres(databaseUrl.toString(), globalMigrationInventory)).toBe(23)
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 15_000)

  test('appends canonical ranked, career, discovery, and pulse state after the applied Players prefix', async () => {
    const databaseName = `brawltome_player_prefix_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      expect(await migratePostgres(databaseUrl.toString(), playerMigrationInventory.slice(0, 2))).toBe(2)
      expect(await migratePostgres(databaseUrl.toString(), playerMigrationInventory)).toBe(11)
      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const [rankedProfiles] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.ranked_profiles')::text AS table_name
        `
        const [careerProfiles] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.career_profiles')::text AS table_name
        `
        const [rankedPulseState] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.ranked_v1_pulse_state')::text AS table_name
        `
        expect(rankedProfiles.table_name).toBe('players.ranked_profiles')
        expect(careerProfiles.table_name).toBe('players.career_profiles')
        expect(rankedPulseState.table_name).toBe('players.ranked_v1_pulse_state')
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  })

  test('reconciles only evidenced mojibake career names and enqueues affected player facts idempotently', async () => {
    const databaseName = `bt_player_names_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      const prefix = playerMigrationInventory.slice(0, -3)
      expect(await migratePostgres(databaseUrl.toString(), prefix)).toBe(prefix.length)
      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        await client`
          INSERT INTO players.career_profiles
            (brawlhalla_id, player_name, checked_at, last_success_at, xp, level, xp_percentage,
             games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
             snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
          SELECT seed.brawlhalla_id, seed.player_name, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
                 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
          FROM (VALUES
            (1001, 'MÃ¼ller'),
            (1002, 'Ã©'),
            (1003, 'MÃ\u0083Â¼ller')
          ) AS seed(brawlhalla_id, player_name)
        `
        await client`
          INSERT INTO players.legacy_profile_discovery
            (brawlhalla_id, player_name, rating, best_legend, observed_at, archive_checksum)
          VALUES
            (1001, 'Müller', NULL, NULL, '2025-01-01T00:00:00Z', ${'0'.repeat(64)}),
            (1003, 'MÃ¼ller', NULL, NULL, '2025-01-01T00:00:00Z', ${'2'.repeat(64)}),
            (2002, 'é', NULL, NULL, '2025-01-01T00:00:00Z', ${'3'.repeat(64)})
        `
        await client`
          INSERT INTO players.discovery_aliases
            (brawlhalla_id, normalized_alias, display_alias, observed_at)
          VALUES (1001, 'mã¼ller', 'MÃ¼ller', '2025-01-01T00:00:00Z')
        `
        await client`DELETE FROM players.discovery_outbox`
        const [baseline] = await client<{ source_version: string }[]>`
          SELECT source_version FROM players.discovery_state WHERE singleton
        `

        expect(await migratePostgres(databaseUrl.toString(), playerMigrationInventory.slice(0, -2))).toBe(1)

        const careers = await client<{ brawlhalla_id: number; player_name: string; last_success_at: string }[]>`
          SELECT brawlhalla_id, player_name, last_success_at::text
          FROM players.career_profiles ORDER BY brawlhalla_id
        `
        expect([...careers]).toEqual([
          { brawlhalla_id: 1001, player_name: 'Müller', last_success_at: '2026-01-01 00:00:00+00' },
          { brawlhalla_id: 1002, player_name: 'Ã©', last_success_at: '2026-01-01 00:00:00+00' },
          { brawlhalla_id: 1003, player_name: 'MÃ\u0083Â¼ller', last_success_at: '2026-01-01 00:00:00+00' },
        ])
        const aliases = await client`SELECT * FROM players.discovery_aliases`
        expect([...aliases]).toEqual([])
        const outbox = await client<{ brawlhalla_id: number; source_version: string }[]>`
          SELECT brawlhalla_id, source_version FROM players.discovery_outbox ORDER BY brawlhalla_id
        `
        expect(outbox.map(({ brawlhalla_id }) => brawlhalla_id)).toEqual([1001])
        expect(new Set(outbox.map(({ source_version }) => source_version))).toEqual(
          new Set([(Number(baseline.source_version) + 1).toString()]),
        )

        const [before] = await client<{ event_count: number; source_version: string }[]>`
          SELECT (SELECT count(*)::integer FROM players.discovery_outbox) AS event_count, source_version
          FROM players.discovery_state WHERE singleton
        `
        await client.unsafe(playerMigrationInventory[10].sql)
        const [after] = await client<{ event_count: number; source_version: string }[]>`
          SELECT (SELECT count(*)::integer FROM players.discovery_outbox) AS event_count, source_version
          FROM players.discovery_state WHERE singleton
        `
        expect(after).toEqual(before)
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 15_000)

  test('appends interactive, leaderboard, lease-fence, clan, and dead-letter migrations after a scheduling prefix', async () => {
    const databaseName = `brawltome_migration_prefix_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory.slice(0, 2))).toBe(2)
      expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory)).toBe(
        refreshOperationsMigrationInventory.length - 2,
      )
      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const history = await client<{ identity: string }[]>`
          SELECT identity FROM brawltome_migrations.history ORDER BY ordinal
        `
        expect(history.map(({ identity }) => identity)).toEqual(
          refreshOperationsMigrationInventory.map(({ identity }) => identity),
        )
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  })

  test('backfills active player resource identity when adding Primary monitoring', async () => {
    const databaseName = `bt_primary_upgrade_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory.slice(0, 11))).toBe(11)
      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const operationIds = [randomUUID(), randomUUID()]
        for (const [index, operationId] of operationIds.entries()) {
          await client`
            INSERT INTO refresh_operations.operations
              (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
               status, max_attempts, reservation_token, reservation_expires_at)
            VALUES
              (${operationId}, ${operationId}, 'interactive-player-refresh', ${`legacy-dedupe-${index}`},
               ${`legacy-operation-${index}`}, 'interactive',
               ${client.json({ brawlhallaId: 42, staleSections: ['ranked', 'stats'] })},
               ${client.json({ source: 'migration-test' })}, 'awaiting_admission', 3, ${randomUUID()},
               clock_timestamp() + interval '1 minute')
          `
        }
        expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory)).toBe(
          refreshOperationsMigrationInventory.length - 11,
        )
        const operations = await client<{ resource_key: string; status: string; error_code: string | null }[]>`
          SELECT resource_key, status, last_error->>'code' AS error_code
          FROM refresh_operations.operations
          WHERE id IN ${client(operationIds)}
          ORDER BY status
        `
        expect(
          operations.map(({ resource_key, status, error_code }) => ({ resource_key, status, error_code })),
        ).toEqual([
          { resource_key: 'player:42', status: 'awaiting_admission', error_code: null },
          { resource_key: 'player:42', status: 'dead_letter', error_code: 'superseded_player_refresh' },
        ])
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 15_000)

  test('appends the active lease fence after an applied leaderboard prefix', async () => {
    const databaseName = `brawltome_lease_fence_prefix_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory.slice(0, 5))).toBe(5)
      expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory.slice(0, 6))).toBe(1)
      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const [activeLeaseFence] = await client<{ function_name: string | null }[]>`
          SELECT to_regprocedure(
            'refresh_operations.acquire_active_lease(uuid,text,bigint)'
          )::text AS function_name
        `
        const [interactiveSectionFence] = await client<{ function_name: string | null }[]>`
          SELECT to_regprocedure(
            'refresh_operations.commit_interactive_section_if_owned(uuid,text,bigint,text)'
          )::text AS function_name
        `
        expect(activeLeaseFence.function_name).toContain('acquire_active_lease')
        expect(interactiveSectionFence.function_name).toContain('commit_interactive_section_if_owned')
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  })

  test('serializes fresh runners, applies once, reruns as a no-op, and rolls back failures', async () => {
    const databaseName = `brawltome_migrations_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      const applications = await Promise.all([
        migratePostgres(databaseUrl.toString(), globalMigrationInventory),
        migratePostgres(databaseUrl.toString(), globalMigrationInventory),
      ])
      expect(applications.sort()).toEqual([0, globalMigrationInventory.length])
      expect(await migratePostgres(databaseUrl.toString(), globalMigrationInventory)).toBe(0)

      const failingSql = 'CREATE TABLE players.rollback_probe (id integer); SELECT * FROM players.missing_table;'
      const failingMigration: Migration = {
        identity: 'players/0014',
        predecessor: 'players/0013',
        checksum: checksumSql(failingSql),
        sql: failingSql,
      }
      await expect(
        migratePostgres(databaseUrl.toString(), [...globalMigrationInventory, failingMigration]),
      ).rejects.toThrow()

      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const history = await client<{ identity: string; checksum: string }[]>`
          SELECT identity, checksum
          FROM brawltome_migrations.history
          ORDER BY ordinal
        `
        const [schema] = await client<{ exists: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'players') AS exists
        `
        const [refreshOperationsSchema] = await client<{ exists: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'refresh_operations') AS exists
        `
        const [requestAdmissionSchema] = await client<{ exists: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'request_admission') AS exists
        `
        const [clansSchema] = await client<{ exists: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'clans') AS exists
        `
        const [playerRefreshEffects] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.interactive_refresh_effects')::text AS table_name
        `
        const [rankedProfiles] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.ranked_profiles')::text AS table_name
        `
        const [rankedSoloQueue] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.ranked_solo_queue')::text AS table_name
        `
        const [careerProfiles] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.career_profiles')::text AS table_name
        `
        const [rankedPulseState] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.ranked_v1_pulse_state')::text AS table_name
        `
        const [activeLeaseFence] = await client<{ function_name: string | null }[]>`
          SELECT to_regprocedure(
            'refresh_operations.acquire_active_lease(uuid,text,bigint)'
          )::text AS function_name
        `
        const [interactiveSectionFence] = await client<{ function_name: string | null }[]>`
          SELECT to_regprocedure(
            'refresh_operations.commit_interactive_section_if_owned(uuid,text,bigint,text)'
          )::text AS function_name
        `
        const [statisticsEffectFence] = await client<{ function_name: string | null }[]>`
          SELECT to_regprocedure(
            'refresh_operations.record_statistics_collection_effect(uuid,text,text,text,bigint)'
          )::text AS function_name
        `
        const [rollbackProbe] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.rollback_probe')::text AS table_name
        `

        expect(history.map(({ identity, checksum }) => ({ identity, checksum: checksum.trim() }))).toEqual(
          globalMigrationInventory.map(({ identity, checksum }) => ({ identity, checksum })),
        )
        expect(schema.exists).toBe(true)
        expect(refreshOperationsSchema.exists).toBe(true)
        expect(requestAdmissionSchema.exists).toBe(true)
        expect(clansSchema.exists).toBe(true)
        expect(playerRefreshEffects.table_name).toBe('players.interactive_refresh_effects')
        expect(rankedProfiles.table_name).toBe('players.ranked_profiles')
        expect(rankedSoloQueue.table_name).toBe('players.ranked_solo_queue')
        expect(careerProfiles.table_name).toBe('players.career_profiles')
        expect(rankedPulseState.table_name).toBe('players.ranked_v1_pulse_state')
        expect(activeLeaseFence.function_name).toContain('acquire_active_lease')
        expect(interactiveSectionFence.function_name).toContain('commit_interactive_section_if_owned')
        expect(statisticsEffectFence.function_name).toContain('record_statistics_collection_effect')
        expect(rollbackProbe.table_name).toBeNull()
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)
})
