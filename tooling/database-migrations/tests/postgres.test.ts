import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { accountsMigrationInventory } from '@brawltome/accounts/composition'
import { clanMigrationInventory } from '@brawltome/clan/composition'
import { discoveryMigrationInventory } from '@brawltome/discovery/composition'
import { playerMigrationInventory } from '@brawltome/player/composition'
import { rankingMigrationInventory } from '@brawltome/ranking/composition'
import { refreshOperationsMigrationInventory } from '@brawltome/refresh-operations/composition'
import { requestAdmissionMigrationInventory } from '@brawltome/request-admission/composition'
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
] as const

describe.skipIf(!connectionString)('PostgreSQL migration runner', () => {
  test('inventories Accounts 0001 through 0004, Players 0001 through 0005, and Refresh Operations 0001 through 0010', () => {
    expect(accountsMigrationInventory.map(({ identity }) => identity)).toEqual([
      'accounts/0001',
      'accounts/0002',
      'accounts/0003',
      'accounts/0004',
    ])
    expect(playerMigrationInventory.map(({ identity }) => identity)).toEqual([
      'players/0001',
      'players/0002',
      'players/0003',
      'players/0004',
      'players/0005',
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
    ])
  })

  test('preserves the complete pre-Clans global history as an applied prefix', async () => {
    const oldGlobalInventory = [
      ...playerMigrationInventory.slice(0, 3),
      ...refreshOperationsMigrationInventory.slice(0, 6),
      ...requestAdmissionMigrationInventory,
      ...accountsMigrationInventory.slice(0, 2),
      rankingMigrationInventory[0],
    ]
    expect(globalMigrationInventory.slice(0, oldGlobalInventory.length)).toEqual(oldGlobalInventory)
    expect(globalMigrationInventory.slice(oldGlobalInventory.length)).toEqual([
      ...clanMigrationInventory,
      refreshOperationsMigrationInventory[6],
      refreshOperationsMigrationInventory[7],
      accountsMigrationInventory[2],
      refreshOperationsMigrationInventory[8],
      rankingMigrationInventory[1],
      playerMigrationInventory[3],
      playerMigrationInventory[4],
      refreshOperationsMigrationInventory[9],
      ...discoveryMigrationInventory,
      accountsMigrationInventory[3],
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

  test('preserves the deployed global history before every later migration', async () => {
    expect(
      globalMigrationInventory
        .slice(0, deployedGlobalHistory.length)
        .map(({ identity, checksum }) => [identity, checksum]),
    ).toEqual(deployedGlobalHistory.map((entry) => [...entry]))
    const oldGlobalInventory = globalMigrationInventory.slice(0, deployedGlobalHistory.length)
    expect(globalMigrationInventory.slice(deployedGlobalHistory.length)).toEqual([
      refreshOperationsMigrationInventory[7],
      accountsMigrationInventory[2],
      refreshOperationsMigrationInventory[8],
      rankingMigrationInventory[1],
      playerMigrationInventory[3],
      playerMigrationInventory[4],
      refreshOperationsMigrationInventory[9],
      ...discoveryMigrationInventory,
      accountsMigrationInventory[3],
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
      expect(await migratePostgres(databaseUrl.toString(), globalMigrationInventory)).toBe(
        globalMigrationInventory.length - oldGlobalInventory.length,
      )
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 15_000)

  test('appends canonical ranked state after the applied Players prefix', async () => {
    const databaseName = `brawltome_player_prefix_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      expect(await migratePostgres(databaseUrl.toString(), playerMigrationInventory.slice(0, 2))).toBe(2)
      expect(await migratePostgres(databaseUrl.toString(), playerMigrationInventory)).toBe(3)
      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const [rankedProfiles] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.ranked_profiles')::text AS table_name
        `
        const [careerProfiles] = await client<{ table_name: string | null }[]>`
          SELECT to_regclass('players.career_profiles')::text AS table_name
        `
        expect(rankedProfiles.table_name).toBe('players.ranked_profiles')
        expect(careerProfiles.table_name).toBe('players.career_profiles')
      } finally {
        await client.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  })

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
      expect(await migratePostgres(databaseUrl.toString(), refreshOperationsMigrationInventory)).toBe(8)
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
        identity: 'players/0006',
        predecessor: 'players/0005',
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
        expect(activeLeaseFence.function_name).toContain('acquire_active_lease')
        expect(interactiveSectionFence.function_name).toContain('commit_interactive_section_if_owned')
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
