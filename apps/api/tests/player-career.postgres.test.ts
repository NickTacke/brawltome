import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  createPostgresCareerPlayers,
  createPostgresRankedPlayers,
  playerMigrationInventory,
  refreshCanonicalCareerPlayer,
  refreshCanonicalRankedPlayer,
} from '@brawltome/player/composition'
import type { OperationLease } from '@brawltome/refresh-operations'
import {
  type PostgresRefreshOperations,
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_career_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

const emptySnapshot = {
  brawlhalla_id: 91913839,
  name: 'Measured Zero',
  xp: 0,
  level: 0,
  xp_percentage: 0,
  games: 0,
  wins: 0,
  damagebomb: '9007199254740993',
  damagemine: '0',
  damagespikeball: '0',
  damagesidekick: '0',
  hitsnowball: 0,
  kobomb: 0,
  komine: 0,
  kospikeball: 0,
  kosidekick: 0,
  kosnowball: 0,
  legends: [],
}

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Players career integration tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of [...playerMigrationInventory, ...refreshOperationsMigrationInventory]) {
      await setup.unsafe(migration.sql)
    }
  } finally {
    await setup.end()
  }
})

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

const admission = {
  totalConcurrency: 2,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 1,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
} as const

async function claimCareerOperation(
  operations: PostgresRefreshOperations,
  brawlhallaId: number,
  staleSections: Array<'ranked' | 'stats'> = ['stats'],
) {
  const reserved = await operations.reserveInteractivePlayerRefresh({
    dedupeKey: `career:${randomUUID()}`,
    operationKey: `career:${randomUUID()}`,
    brawlhallaId,
    staleSections,
    provenance: { source: 'integration-test' },
    reservationTtlSeconds: 30,
  })
  if (reserved.outcome !== 'reserved') throw new Error('Expected a reserved operation')
  await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
  const lease = await operations.claim('career-test-worker', 10_000, admission)
  if (!lease || lease.kind !== 'interactive-player-refresh') throw new Error('Expected an interactive lease')
  return lease
}

function effectFor(lease: Extract<OperationLease, { kind: 'interactive-player-refresh' }>) {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    effectCreatedAt: lease.effectCreatedAt,
    section: 'stats' as const,
  }
}

const source = (payload: unknown) => ({
  getStats: async (_id: number, options: { onAttempt(): void }) => {
    options.onAttempt()
    return payload
  },
})

const populatedLegend = {
  legend_id: 3,
  legend_name_key: 'bodvar',
  xp: 100,
  level: 2,
  xp_percentage: 0.5,
  games: 10,
  wins: 4,
  matchtime: 600,
  kos: 20,
  falls: 15,
  suicides: 0,
  teamkos: 1,
  damagedealt: '9007199254740993',
  damagetaken: '800',
  damageunarmed: '100',
  damagethrownitem: '10',
  damagegadgets: '20',
  kounarmed: 2,
  kothrownitem: 1,
  kogadgets: 0,
  damageweaponone: '9007199254740993',
  damageweapontwo: '7',
  koweaponone: 12,
  koweapontwo: 5,
  timeheldweaponone: 500,
  timeheldweapontwo: 100,
}

const resolveLegend = (legendId: number, legendNameKey: string) =>
  legendId === 3 && legendNameKey === 'bodvar'
    ? { legendId, legendNameKey, weaponOne: 'Hammer', weaponTwo: 'Sword' }
    : null

async function expireLease(operationId: string) {
  const control = postgres(connectionString, { max: 1 })
  try {
    await control`
      UPDATE refresh_operations.operations
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${operationId}
    `
  } finally {
    await control.end()
  }
}

describe('Players-owned canonical career state', () => {
  test('persists measured zero and authoritative empty collections through a fenced stats operation', async () => {
    const players = createPostgresCareerPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const lease = await claimCareerOperation(operations, 91913839)
      expect(await operations.beginInteractiveSection(lease, 'stats')).toBe('execute')

      await refreshCanonicalCareerPlayer(
        players,
        source(emptySnapshot),
        91913839,
        { caller: 'on-demand' },
        effectFor(lease),
        resolveLegend,
      )
      expect(await operations.beginInteractiveSection(lease, 'stats')).toBe('already-applied')
      expect(await operations.complete(lease)).toBe('transitioned')

      expect(await players.referenceById(91913839)).toEqual({
        brawlhallaId: 91913839,
        name: 'Measured Zero',
      })
      const profile = await players.byId(91913839)
      expect(profile?.snapshot).toMatchObject({
        account: { xp: 0, level: 0, xpPercentage: 0 },
        combat: { games: 0, wins: 0, matchTime: 0, damageBomb: '9007199254740993' },
        legends: [],
        weapons: [],
      })
      expect(profile?.checkedAt).toBeInstanceOf(Date)
      expect(profile?.lastSuccessAt).toEqual(profile?.checkedAt)
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('retains the last success after a malformed attempt and authoritatively clears children on retry', async () => {
    const brawlhallaId = 91913840
    const players = createPostgresCareerPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    const populated = { ...emptySnapshot, brawlhalla_id: brawlhallaId, legends: [populatedLegend] }
    try {
      const firstLease = await claimCareerOperation(operations, brawlhallaId)
      await refreshCanonicalCareerPlayer(
        players,
        source(populated),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(firstLease),
        resolveLegend,
      )
      await operations.complete(firstLease)
      const first = await players.byId(brawlhallaId)
      if (!first?.lastSuccessAt) throw new Error('Expected an initial career success')
      expect(first.snapshot?.legends).toEqual([
        expect.objectContaining({
          legendId: 3,
          damageDealt: '9007199254740993',
          weaponOne: { damage: '9007199254740993', kos: 12, heldTime: 500 },
          weaponTwo: { damage: '7', kos: 5, heldTime: 100 },
        }),
      ])
      expect(first.snapshot?.weapons).toEqual([
        { weapon: 'Hammer', heldTime: 500, damage: '9007199254740993', kos: 12 },
        { weapon: 'Sword', heldTime: 100, damage: '7', kos: 5 },
      ])

      await Bun.sleep(5)
      const retryLease = await claimCareerOperation(operations, brawlhallaId)
      await expect(
        refreshCanonicalCareerPlayer(
          players,
          source({ ...populated, legends: undefined }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(retryLease),
          resolveLegend,
        ),
      ).rejects.toThrow('career.legends must be an array')

      const retained = await players.byId(brawlhallaId)
      expect(retained?.lastSuccessAt).toEqual(first.lastSuccessAt)
      expect(retained?.checkedAt.getTime()).toBeGreaterThan(first.checkedAt.getTime())
      expect(retained?.snapshot?.legends).toHaveLength(1)
      expect(retained?.snapshot?.weapons).toHaveLength(2)

      await refreshCanonicalCareerPlayer(
        players,
        source({ ...emptySnapshot, brawlhalla_id: brawlhallaId }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(retryLease),
        resolveLegend,
      )
      await operations.complete(retryLease)
      const cleared = await players.byId(brawlhallaId)
      expect(cleared?.snapshot?.legends).toEqual([])
      expect(cleared?.snapshot?.weapons).toEqual([])
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('skips a committed ranked section when career retries after failure', async () => {
    const brawlhallaId = 91913843
    const careerPlayers = createPostgresCareerPlayers(connectionString)
    const rankedPlayers = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    const rankedPayload = {
      name: 'Independent Sections',
      brawlhalla_id: brawlhallaId,
      rating: 1500,
      peak_rating: 1510,
      tier: 'Gold 1',
      wins: 4,
      games: 9,
      region: 'US-E',
      global_rank: 0,
      region_rank: 0,
      legends: [],
      '2v2': [],
    }
    try {
      const firstLease = await claimCareerOperation(operations, brawlhallaId, ['ranked', 'stats'])
      await refreshCanonicalRankedPlayer(
        rankedPlayers,
        {
          getRanked: async (_id, options) => {
            options.onAttempt()
            return rankedPayload
          },
        },
        brawlhallaId,
        { caller: 'on-demand' },
        { ...effectFor(firstLease), section: 'ranked' },
      )
      const rankedSuccess = await rankedPlayers.byId(brawlhallaId)
      await expect(
        refreshCanonicalCareerPlayer(
          careerPlayers,
          source({ ...emptySnapshot, brawlhalla_id: brawlhallaId, legends: undefined }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(firstLease),
          resolveLegend,
        ),
      ).rejects.toThrow('career.legends must be an array')
      expect((await rankedPlayers.byId(brawlhallaId))?.lastSuccessAt).toEqual(rankedSuccess?.lastSuccessAt)
      expect((await careerPlayers.byId(brawlhallaId))?.lastSuccessAt).toBeNull()
      await operations.fail(firstLease, { code: 'career_failed', message: 'career failed', retryable: true }, 0)

      const retry = await operations.claim('career-section-retry', 10_000, admission)
      if (!retry || retry.kind !== 'interactive-player-refresh') throw new Error('Expected a player retry lease')
      expect(await operations.beginInteractiveSection(retry, 'ranked')).toBe('already-applied')
      expect(await operations.beginInteractiveSection(retry, 'stats')).toBe('execute')
      await refreshCanonicalCareerPlayer(
        careerPlayers,
        source({ ...emptySnapshot, brawlhalla_id: brawlhallaId }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(retry),
        resolveLegend,
      )
      await operations.complete(retry)

      expect((await rankedPlayers.byId(brawlhallaId))?.lastSuccessAt).toEqual(rankedSuccess?.lastSuccessAt)
      expect((await careerPlayers.byId(brawlhallaId))?.snapshot?.legends).toEqual([])
    } finally {
      await Promise.all([careerPlayers.close(), rankedPlayers.close(), operations.close()])
    }
  })

  test('upgrades a legacy stats marker and still writes the complete canonical snapshot', async () => {
    const brawlhallaId = 91913844
    const players = createPostgresCareerPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    const control = postgres(connectionString, { max: 1 })
    try {
      const lease = await claimCareerOperation(operations, brawlhallaId)
      await control`
        INSERT INTO players.interactive_refresh_effects (operation_id, section, lease_token)
        VALUES (${lease.operationId}::uuid, 'stats', ${lease.leaseToken})
      `

      await expect(
        refreshCanonicalCareerPlayer(
          players,
          source({ ...emptySnapshot, brawlhalla_id: brawlhallaId, legends: [populatedLegend] }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(lease),
          resolveLegend,
        ),
      ).resolves.toBe('applied')
      expect((await players.byId(brawlhallaId))?.snapshot?.legends).toHaveLength(1)
      const [effect] = await control<{ effect_version: number | null }[]>`
        SELECT effect_version
        FROM players.interactive_refresh_effects
        WHERE operation_id = ${lease.operationId}::uuid AND section = 'stats'
      `
      expect(effect.effect_version).toBe(1)
      expect(await operations.complete(lease)).toBe('transitioned')
    } finally {
      await Promise.all([players.close(), operations.close(), control.end()])
    }
  })

  test('lets only the reclaimed lease publish when old and new writers overlap', async () => {
    const brawlhallaId = 91913845
    const players = createPostgresCareerPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    const control = postgres(connectionString, { max: 1 })
    try {
      const oldLease = await claimCareerOperation(operations, brawlhallaId)
      await expireLease(oldLease.operationId)
      const newLease = await operations.claim('career-race-successor', 10_000, admission)
      if (!newLease || newLease.kind !== 'interactive-player-refresh') throw new Error('Expected successor lease')

      const [oldWriter, newWriter] = await Promise.allSettled([
        refreshCanonicalCareerPlayer(
          players,
          source({ ...emptySnapshot, brawlhalla_id: brawlhallaId, name: 'Old writer' }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(oldLease),
          resolveLegend,
        ),
        refreshCanonicalCareerPlayer(
          players,
          source({ ...emptySnapshot, brawlhalla_id: brawlhallaId, name: 'New writer' }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(newLease),
          resolveLegend,
        ),
      ])

      expect(oldWriter.status).toBe('rejected')
      expect(newWriter).toEqual({ status: 'fulfilled', value: 'applied' })
      expect(await operations.complete(newLease)).toBe('transitioned')
      const [profile] = await control<{ player_name: string }[]>`
        SELECT player_name FROM players.career_profiles WHERE brawlhalla_id = ${brawlhallaId}
      `
      expect(profile.player_name).toBe('New writer')
    } finally {
      await Promise.all([players.close(), operations.close(), control.end()])
    }
  })

  test('preserves a successful career section when ranked decoding fails', async () => {
    const brawlhallaId = 91913846
    const careerPlayers = createPostgresCareerPlayers(connectionString)
    const rankedPlayers = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const lease = await claimCareerOperation(operations, brawlhallaId, ['stats', 'ranked'])
      await refreshCanonicalCareerPlayer(
        careerPlayers,
        source({ ...emptySnapshot, brawlhalla_id: brawlhallaId, legends: [populatedLegend] }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(lease),
        resolveLegend,
      )
      const careerSuccess = await careerPlayers.byId(brawlhallaId)

      await expect(
        refreshCanonicalRankedPlayer(
          rankedPlayers,
          {
            getRanked: async (_id, options) => {
              options.onAttempt()
              return { brawlhalla_id: brawlhallaId }
            },
          },
          brawlhallaId,
          { caller: 'on-demand' },
          { ...effectFor(lease), section: 'ranked' },
        ),
      ).rejects.toThrow()

      expect((await careerPlayers.byId(brawlhallaId))?.lastSuccessAt).toEqual(careerSuccess?.lastSuccessAt)
      expect((await careerPlayers.byId(brawlhallaId))?.snapshot?.weapons).toEqual(careerSuccess?.snapshot?.weapons)
      expect((await rankedPlayers.byId(brawlhallaId))?.lastSuccessAt).toBeNull()
      await operations.fail(lease, { code: 'ranked_failed', message: 'ranked failed', retryable: false }, 0)
    } finally {
      await Promise.all([careerPlayers.close(), rankedPlayers.close(), operations.close()])
    }
  })

  test('rejects writes after lease expiry', async () => {
    const brawlhallaId = 91913841
    const players = createPostgresCareerPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const lease = await claimCareerOperation(operations, brawlhallaId)
      await expireLease(lease.operationId)
      await expect(
        refreshCanonicalCareerPlayer(
          players,
          source({ ...emptySnapshot, brawlhalla_id: brawlhallaId }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(lease),
          resolveLegend,
        ),
      ).rejects.toThrow('lease lost')
      expect(await players.byId(brawlhallaId)).toBeNull()
      const recoveryLease = await operations.claim('expired-career-cleanup', 10_000, admission)
      if (!recoveryLease) throw new Error('Expected the expired operation to be reclaimed')
      await operations.fail(recoveryLease, { code: 'test-cleanup', message: 'test cleanup', retryable: false }, 0)
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('reconciles a crash after the atomic career checkpoint without replaying the effect', async () => {
    const brawlhallaId = 91913842
    const players = createPostgresCareerPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const lease = await claimCareerOperation(operations, brawlhallaId)
      await refreshCanonicalCareerPlayer(
        players,
        source({ ...emptySnapshot, brawlhalla_id: brawlhallaId }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(lease),
        resolveLegend,
      )
      expect(await operations.beginInteractiveSection(lease, 'stats')).toBe('already-applied')

      await expireLease(lease.operationId)
      expect(await operations.claim('career-recovery-worker', 10_000, admission)).toBeNull()
      expect((await operations.inspect(lease.operationId)).operation.status).toBe('succeeded')
      expect((await players.byId(brawlhallaId))?.snapshot?.legends).toEqual([])
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })
})
