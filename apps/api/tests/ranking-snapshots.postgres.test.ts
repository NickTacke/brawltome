import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  type LeaderboardMode,
  type PublishedLeaderboardRow,
  type RegionalLeaderboardScope,
  leaderboardModes,
  regionalLeaderboardScopes,
} from '@brawltome/ranking'
import {
  type LeaderboardGenerationCandidate,
  type RankingPublicationAuthorization,
  createPostgresRanking,
  rankingMigrationInventory,
} from '@brawltome/ranking/composition'
import type { LeaderboardOperationKind, OperationLease } from '@brawltome/refresh-operations'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import {
  createPostgresRequestAdmission,
  requestAdmissionMigrationInventory,
} from '@brawltome/request-admission/composition'
import postgres from 'postgres'
import { runOneDurableOperation } from '../src/refresh-operations-worker'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_rankings_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

const intervalMs = 15 * 60 * 1000
const admission = {
  totalConcurrency: 8,
  interactiveReservation: 2,
  classConcurrency: {
    interactive: 4,
    'primary-monitoring': 2,
    leaderboard: 4,
    'global-statistics': 1,
    projection: 2,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
} as const

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Ranking PostgreSQL tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of [
      ...refreshOperationsMigrationInventory,
      ...requestAdmissionMigrationInventory,
      ...rankingMigrationInventory,
    ]) {
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

function operationKind(mode: LeaderboardMode): LeaderboardOperationKind {
  return mode === 'solo2v2' ? 'leaderboard-solo-2v2' : (`leaderboard-${mode}` as LeaderboardOperationKind)
}

function authorization(
  lease: Extract<OperationLease, { workClass: 'leaderboard' }>,
  scheduleWindowAt = lease.scheduleWindowAt,
): RankingPublicationAuthorization {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    operationKind: lease.kind,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    scheduleWindowAt,
  }
}

function sourceIdentity(mode: LeaderboardMode, id: number, variant = 0) {
  const player = { id, username: `${mode} Player ${variant}-${id}` }
  if (mode === '1v1') return { type: 'one-vs-one-player' as const, player }
  if (mode === 'solo2v2') return { type: 'solo-two-vs-two-player' as const, player }
  if (mode === '3v3') return { type: 'three-vs-three-player' as const, player }
  return {
    type: 'fixed-two-vs-two-team' as const,
    players: [player, { id: id + 500_000, username: `Teammate ${variant}-${id}` }] as const,
  }
}

function publishedIdentity(identity: ReturnType<typeof sourceIdentity>): PublishedLeaderboardRow['identity'] {
  if (identity.type === 'fixed-two-vs-two-team') {
    const [first, second] = identity.players
    return {
      type: identity.type,
      players: [
        { brawlhallaId: first.id, name: first.username },
        { brawlhallaId: second.id, name: second.username },
      ],
    }
  }
  return {
    type: identity.type,
    player: { brawlhallaId: identity.player.id, name: identity.player.username },
  }
}

function sourceRow(mode: LeaderboardMode, region: RegionalLeaderboardScope, index: number, variant = 0) {
  const regionIndex = regionalLeaderboardScopes.indexOf(region)
  const id = variant * 1_000_000 + regionIndex * 10_000 + index + 1
  return {
    identity: sourceIdentity(mode, id, variant),
    rating: 2400 - index - regionIndex,
    best_rating: 2450 - index - regionIndex,
    rank: index + 1,
    wins: 20,
    losses: 10,
    region,
    tier: 'Diamond',
  }
}

function candidate(
  mode: LeaderboardMode,
  operationKey: string,
  scheduleWindowAt = new Date(Date.now() + intervalMs),
  rowsPerRegion = 1,
  variant = 0,
): LeaderboardGenerationCandidate {
  const regional = new Map(
    regionalLeaderboardScopes.map((region) => [
      region,
      Array.from({ length: rowsPerRegion }, (_, index) => {
        const row = sourceRow(mode, region, index, variant)
        return {
          standing: row.rank,
          sourceRank: row.rank,
          identity: publishedIdentity(row.identity),
          region,
          rating: row.rating,
          peakRating: row.best_rating,
          wins: row.wins,
          losses: row.losses,
          tier: row.tier,
        }
      }),
    ]),
  )
  const global = [...regional.values()]
    .flat()
    .sort((left, right) => right.rating - left.rating || left.sourceRank - right.sourceRank)
    .map((row, index) => ({ ...row, standing: index + 1 }))
  return {
    mode,
    operationKey,
    observedAt: new Date(scheduleWindowAt.getTime() + 1_000),
    scheduleWindowAt,
    expectedNextPublicationAt: new Date(scheduleWindowAt.getTime() + intervalMs),
    pageDepth: 1,
    snapshots: new Map([...regional, ['all' as const, global]]),
  }
}

async function leaseOperation(
  operations: ReturnType<typeof createPostgresRefreshOperations>,
  mode: LeaderboardMode,
  label: string,
  options: { operationKey?: string; maxAttempts?: number } = {},
) {
  const kind = operationKind(mode)
  const accepted = await operations.accept({
    kind,
    dedupeKey: `ranking:${label}:${randomUUID()}`,
    operationKey: options.operationKey ?? `ranking-effect:${label}:${randomUUID()}`,
    workClass: 'leaderboard',
    payload: { pageDepth: 1, intervalMs },
    provenance: { source: 'ranking-postgres-test' },
    maxAttempts: options.maxAttempts,
  })
  const lease = await operations.claim(`worker:${label}`, 10_000, admission, kind)
  if (
    !lease ||
    lease.operationId !== accepted.operationId ||
    lease.workClass !== 'leaderboard' ||
    lease.kind !== kind
  ) {
    throw new Error(`Expected ${kind} lease`)
  }
  return lease
}

function validSource(mode: LeaderboardMode, variant = 0, rows = 1) {
  return {
    async fetchPage(input: { mode: LeaderboardMode; region: RegionalLeaderboardScope; page: number }) {
      if (input.mode !== mode) throw new Error('source mode mismatch')
      return {
        rankings: Array.from({ length: rows }, (_, index) => sourceRow(mode, input.region, index, variant)),
        totalPages: 1,
      }
    },
  }
}

function identityName(entry: { identity: PublishedLeaderboardRow['identity'] }): string {
  return entry.identity.type === 'fixed-two-vs-two-team' ? entry.identity.players[0].name : entry.identity.player.name
}

async function createTestDatabase(prefix: string) {
  const name = `${prefix}_${process.pid}_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  const url = new URL(baseUrl as string)
  url.pathname = `/${name}`
  return { name, url: url.toString() }
}

describe('Ranking mode migrations', () => {
  test('backfills applied #201 snapshots, effects, and unknowable failure scopes without mutating immutable rows', async () => {
    const database = await createTestDatabase('brawltome_ranking_backfill')
    const client = postgres(database.url, { max: 1 })
    try {
      for (const migration of refreshOperationsMigrationInventory.slice(0, 8)) await client.unsafe(migration.sql)
      await client.unsafe(rankingMigrationInventory[0].sql)
      const operationId = randomUUID()
      const generationId = randomUUID()
      const snapshotId = randomUUID()
      await client`
        INSERT INTO refresh_operations.operations
          (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, status, max_attempts)
        VALUES (${operationId}, ${operationId}, 'leaderboard-1v1', ${randomUUID()}, ${randomUUID()}, 'leaderboard',
          ${client.json({ pageDepth: 1, intervalMs })}, ${client.json({ source: 'backfill-test' })}, 'pending', 3)
      `
      await client`
        INSERT INTO refresh_operations.leaderboard_effects (operation_key, operation_id, lease_token)
        VALUES (${randomUUID()}, ${operationId}, 1)
      `
      await client`
        INSERT INTO rankings.generations
          (id, operation_id, operation_key, observed_at, schedule_window_at,
           expected_next_publication_at, page_depth, source, source_contract_version)
        VALUES (${generationId}, ${operationId}, ${randomUUID()}, now(), now(), now() + interval '15 minutes', 1,
          'brawlhalla-v1-ranked-leaderboard', 1)
      `
      await client`INSERT INTO rankings.snapshots (id, generation_id, scope, row_count) VALUES (${snapshotId}, ${generationId}, 'EU', 1)`
      await client`
        INSERT INTO rankings.snapshot_rows
          (snapshot_id, ordinal, standing, source_rank, brawlhalla_id, name, region, rating, peak_rating, wins, losses)
        VALUES (${snapshotId}, 1, 1, 1, 42, 'Ada', 'EU', 2100, 2200, 20, 10)
      `
      await client`
        INSERT INTO rankings.collection_failures
          (id, operation_key, schedule_window_at, checked_at, code, message)
        VALUES (${randomUUID()}, ${randomUUID()}, now(), now(), 'source_unavailable', 'legacy failure')
      `

      await client.unsafe(refreshOperationsMigrationInventory[8].sql)
      await client.unsafe(rankingMigrationInventory[1].sql)
      const [row] = await client<
        { mode: string; identity_kind: string; player_one_id: number; player_two_id: number | null }[]
      >`
        SELECT mode, identity_kind, player_one_id, player_two_id FROM rankings.snapshot_rows
      `
      const [effect] = await client<{ operation_kind: string }[]>`
        SELECT operation_kind FROM refresh_operations.leaderboard_effects
      `
      const [failure] = await client<{ mode: string; scope: string }[]>`
        SELECT mode, scope FROM rankings.collection_failures
      `
      const [generation] = await client<{ finalized: boolean }[]>`
        SELECT finalized FROM rankings.generations WHERE id = ${generationId}
      `
      expect(row).toEqual({ mode: '1v1', identity_kind: 'one-vs-one-player', player_one_id: 42, player_two_id: null })
      expect(effect.operation_kind).toBe('leaderboard-1v1')
      expect(failure).toEqual({ mode: '1v1', scope: 'all' })
      expect(generation.finalized).toBe(true)
      const [scopeColumn] = await client<{ is_nullable: string; column_default: string | null }[]>`
        SELECT is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'rankings' AND table_name = 'collection_failures' AND column_name = 'scope'
      `
      const [scopeConstraint] = await client<{ definition: string }[]>`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'rankings.collection_failures'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%scope%'
      `
      expect(scopeColumn).toEqual({ is_nullable: 'NO', column_default: null })
      expect(scopeConstraint.definition).toContain("scope = ANY (ARRAY['all'::text, 'US-E'::text")
    } finally {
      await client.end()
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database.name}" WITH (FORCE)`)
    }
  })
})

describe('immutable Ranking snapshots for every mode', () => {
  test('publishes all modes independently with fixed-team identity and restart parity', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    let ranking = createPostgresRanking(connectionString)
    for (const [variant, mode] of leaderboardModes.entries()) {
      const lease = await leaseOperation(operations, mode, `publish-${mode}`)
      const publication = candidate(mode, lease.operationKey, undefined, 2, variant + 1)
      if (mode === '2v2') {
        const euRows = publication.snapshots.get('EU')
        if (
          !euRows ||
          euRows[0].identity.type !== 'fixed-two-vs-two-team' ||
          euRows[1].identity.type !== 'fixed-two-vs-two-team'
        ) {
          throw new Error('Expected fixed-team rows')
        }
        publication.snapshots = new Map(publication.snapshots).set('EU', [
          {
            ...euRows[0],
            identity: {
              type: 'fixed-two-vs-two-team',
              players: [
                { brawlhallaId: 91_850_384, name: 'Dounia-la_put921' },
                { brawlhallaId: 91_850_384, name: 'Dounia-la_put921•2' },
              ],
            },
          },
          {
            ...euRows[1],
            identity: {
              type: 'fixed-two-vs-two-team',
              players: [euRows[0].identity.players[0], euRows[1].identity.players[1]],
            },
          },
        ])
      }
      expect(await ranking.publishGeneration(authorization(lease), publication)).toBe('published')
      await operations.complete(lease)
    }

    const fixedEu = await ranking.queries.getLeaderboard({ mode: '2v2', region: 'EU', page: 1 })
    if (fixedEu.status === 'unavailable') throw new Error('Expected fixed standings')
    expect(fixedEu.entries).toHaveLength(2)
    expect(fixedEu.provenance).toEqual({
      source: 'brawlhalla-v1-ranked-leaderboard',
      contractVersion: 2,
      pageDepth: 1,
    })
    if (
      fixedEu.entries[0].identity.type !== 'fixed-two-vs-two-team' ||
      fixedEu.entries[1].identity.type !== 'fixed-two-vs-two-team'
    ) {
      throw new Error('Expected fixed identities')
    }
    const couchTeam = fixedEu.entries.find(
      ({ identity }) =>
        identity.type === 'fixed-two-vs-two-team' &&
        identity.players[0].brawlhallaId === identity.players[1].brawlhallaId,
    )
    expect(couchTeam?.identity).toEqual({
      type: 'fixed-two-vs-two-team',
      players: [
        { brawlhallaId: 91_850_384, name: 'Dounia-la_put921' },
        { brawlhallaId: 91_850_384, name: 'Dounia-la_put921•2' },
      ],
    })

    const fixed = await ranking.queries.getLeaderboard({ mode: '2v2', region: 'all', page: 1 })
    if (fixed.status === 'unavailable') throw new Error('Expected fixed standings')
    expect(fixed.entries[0].identity.type).toBe('fixed-two-vs-two-team')
    if (fixed.entries[0].identity.type !== 'fixed-two-vs-two-team') throw new Error('Expected team')
    expect(fixed.entries[0].identity.players[0].brawlhallaId).toBeGreaterThan(0)
    expect(fixed.entries[0].identity.players[1].brawlhallaId).toBeGreaterThan(
      fixed.entries[0].identity.players[0].brawlhallaId,
    )
    await ranking.close()

    ranking = createPostgresRanking(connectionString)
    for (const mode of leaderboardModes) {
      const view = await ranking.queries.getLeaderboard({ mode, region: 'EU', page: 1 })
      expect(view).toMatchObject({ mode, status: 'fresh', totalRows: 2 })
    }
    await ranking.close()
    await operations.close()
  })

  test('replays a mode-specific dead letter with stable effect identity and fences cross-kind key reuse', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)

    const original = await leaseOperation(operations, 'solo2v2', 'mode-replay', { maxAttempts: 1 })
    await operations.fail(original, { code: 'source_repaired', message: 'repairable', retryable: false }, 0)
    const replayed = await operations.replayDeadLetter({
      operationId: original.operationId,
      actorId: 'operator:ranking',
      reason: 'mode source repaired',
    })
    if (replayed.outcome !== 'replayed') throw new Error('Expected mode-specific replay')
    const successor = await operations.claim('mode-replay-worker', 10_000, admission, 'leaderboard-solo-2v2')
    if (!successor || successor.kind !== 'leaderboard-solo-2v2') throw new Error('Expected Solo 2v2 replay lease')
    expect(successor.effectOperationId).toBe(original.effectOperationId)
    expect(
      await ranking.publishGeneration(
        authorization(successor),
        candidate('solo2v2', successor.operationKey, undefined, 1, 80),
      ),
    ).toBe('published')
    await operations.complete(successor)

    const sharedKey = `cross-kind:${randomUUID()}`
    const oneVsOne = await leaseOperation(operations, '1v1', 'cross-kind-first', { operationKey: sharedKey })
    expect(
      await ranking.publishGeneration(authorization(oneVsOne), candidate('1v1', sharedKey, undefined, 1, 81)),
    ).toBe('published')
    await operations.complete(oneVsOne)
    const threeVsThree = await leaseOperation(operations, '3v3', 'cross-kind-second', { operationKey: sharedKey })
    expect(
      await ranking.publishGeneration(authorization(threeVsThree), candidate('3v3', sharedKey, undefined, 1, 82)),
    ).toBe('effect-conflict')
    await operations.fail(threeVsThree, { code: 'effect_conflict', message: 'cross-kind reuse', retryable: false }, 0)

    const control = postgres(connectionString, { max: 1 })
    const [published] = await control<{ operation_id: string; mode: string }[]>`
      SELECT operation_id, mode FROM rankings.generations WHERE operation_key = ${original.operationKey}
    `
    expect(published).toEqual({ operation_id: original.effectOperationId, mode: 'solo2v2' })
    await control.end()
    await ranking.close()
    await operations.close()
  })

  test('keeps failure and stale state isolated per mode', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const baselineWindow = new Date(Date.now() + 10 * intervalMs)
    for (const mode of ['1v1', 'solo2v2', '3v3'] as const) {
      const lease = await leaseOperation(operations, mode, `isolation-base-${mode}`)
      await ranking.publishGeneration(
        authorization(lease, baselineWindow.toISOString()),
        candidate(mode, lease.operationKey, baselineWindow, 1, 20),
      )
      await operations.complete(lease)
    }
    const failed = await leaseOperation(operations, '3v3', 'isolation-failure')
    expect(
      await ranking.recordCollectionFailure(
        authorization(failed, new Date(baselineWindow.getTime() + intervalMs).toISOString()),
        {
          mode: '3v3',
          scope: 'EU',
          checkedAt: new Date(),
          code: 'source_contract_invalid',
          message: 'drift',
        },
      ),
    ).toBe('recorded')
    await operations.fail(failed, { code: 'source_contract_invalid', message: 'drift', retryable: false }, 0)

    expect((await ranking.queries.getLeaderboard({ mode: '3v3', region: 'all', page: 1 })).status).toBe('stale')
    expect((await ranking.queries.getLeaderboard({ mode: '3v3', region: 'EU', page: 1 })).status).toBe('stale')
    expect((await ranking.queries.getLeaderboard({ mode: '3v3', region: 'US-E', page: 1 })).status).toBe('fresh')
    expect((await ranking.queries.getLeaderboard({ mode: '1v1', region: 'all', page: 1 })).status).toBe('fresh')
    expect((await ranking.queries.getLeaderboard({ mode: '1v1', region: 'EU', page: 1 })).status).toBe('fresh')
    expect((await ranking.queries.getLeaderboard({ mode: 'solo2v2', region: 'all', page: 1 })).status).toBe('fresh')
    await ranking.close()
    await operations.close()
  })

  test('fences concurrent effects, rolls back invalid fixed identity, and enforces immutability', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const sharedKey = `shared:${randomUUID()}`
    const first = await leaseOperation(operations, '2v2', 'concurrent-first', { operationKey: sharedKey })
    const second = await leaseOperation(operations, '2v2', 'concurrent-second', { operationKey: sharedKey })
    const results = await Promise.all([
      ranking.publishGeneration(authorization(first), candidate('2v2', sharedKey, undefined, 1, 30)),
      ranking.publishGeneration(authorization(second), candidate('2v2', sharedKey, undefined, 1, 31)),
    ])
    expect([...results].sort()).toEqual(['effect-conflict', 'published'])
    for (const [lease, result] of [
      [first, results[0]],
      [second, results[1]],
    ] as const) {
      if (result === 'published') await operations.complete(lease)
      else await operations.fail(lease, { code: 'effect-conflict', message: 'conflict', retryable: false }, 0)
    }

    const rollback = await leaseOperation(operations, '2v2', 'rollback')
    const malformed = candidate('2v2', rollback.operationKey, undefined, 1, 32)
    const eu = malformed.snapshots.get('EU')
    if (!eu || eu[0].identity.type !== 'fixed-two-vs-two-team') throw new Error('Expected fixed candidate')
    const players = eu[0].identity.players
    malformed.snapshots = new Map(malformed.snapshots).set('EU', [
      { ...eu[0], identity: { type: 'fixed-two-vs-two-team', players: [players[1], players[0]] } },
    ])
    await expect(ranking.publishGeneration(authorization(rollback), malformed)).rejects.toThrow()
    const control = postgres(connectionString, { max: 1 })
    const [counts] = await control<{ generations: number; effects: number }[]>`
      SELECT
        (SELECT count(*)::int FROM rankings.generations WHERE operation_id = ${rollback.operationId}) AS generations,
        (SELECT count(*)::int FROM refresh_operations.leaderboard_effects WHERE operation_id = ${rollback.operationId}) AS effects
    `
    expect(counts).toEqual({ generations: 0, effects: 0 })
    await operations.fail(rollback, { code: 'storage_invalid', message: 'invalid', retryable: false }, 0)

    const latest = await ranking.queries.getLeaderboard({ mode: '2v2', region: 'all', page: 1 })
    if (latest.status === 'unavailable') throw new Error('Expected snapshot')
    let immutableError: unknown
    try {
      await control`UPDATE rankings.snapshot_rows SET rating = rating + 1 WHERE snapshot_id = ${latest.snapshotId}`
    } catch (error) {
      immutableError = error
    }
    expect(immutableError).toBeInstanceOf(Error)
    expect((immutableError as Error).message).toContain('published ranking snapshots are immutable')

    let insertRowError: unknown
    try {
      await control`
        INSERT INTO rankings.snapshot_rows
          (snapshot_id, mode, ordinal, standing, source_rank, identity_kind, player_one_id, player_one_name,
           player_two_id, player_two_name, region, rating, peak_rating, wins, losses, tier)
        VALUES (${latest.snapshotId}, '2v2', 999, 999, 999, 'fixed-two-vs-two-team', 900000001, 'Late One',
          900000002, 'Late Two', 'EU', 2000, 2100, 1, 1, 'Diamond')
      `
    } catch (error) {
      insertRowError = error
    }
    expect(insertRowError).toBeInstanceOf(Error)
    expect((insertRowError as Error).message).toContain('published ranking snapshots are immutable')

    let insertSnapshotError: unknown
    try {
      await control`
        INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
        VALUES (${randomUUID()}, ${latest.generationId}, '2v2', 'EU', 1)
      `
    } catch (error) {
      insertSnapshotError = error
    }
    expect(insertSnapshotError).toBeInstanceOf(Error)
    expect((insertSnapshotError as Error).message).toContain('published ranking snapshots are immutable')
    await control.end()
    await ranking.close()
    await operations.close()
  }, 20_000)

  test('never exposes an unfinalized publication', async () => {
    const ranking = createPostgresRanking(connectionString)
    const control = postgres(connectionString, { max: 1 })
    const generationId = randomUUID()
    const snapshotId = randomUUID()
    const scheduleWindowAt = new Date(Date.now() + 100 * intervalMs)
    await control`
      INSERT INTO rankings.generations
        (id, operation_id, operation_key, mode, observed_at, schedule_window_at,
         expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
      VALUES (${generationId}, ${randomUUID()}, ${`incomplete:${randomUUID()}`}, '1v1', ${scheduleWindowAt},
        ${scheduleWindowAt}, ${new Date(scheduleWindowAt.getTime() + intervalMs)}, 1,
        'brawlhalla-v1-ranked-leaderboard', 1, false,
        ${control.json({ source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 1, pageDepth: 1 })})
    `
    await control`
      INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
      VALUES (${snapshotId}, ${generationId}, '1v1', 'EU', 1)
    `
    await control`
      INSERT INTO rankings.snapshot_rows
        (snapshot_id, mode, ordinal, standing, source_rank, identity_kind, player_one_id, player_one_name,
         player_two_id, player_two_name, region, rating, peak_rating, wins, losses, tier)
      VALUES (${snapshotId}, '1v1', 1, 1, 1, 'one-vs-one-player', 800000001, 'Incomplete',
        NULL, NULL, 'EU', 2000, 2100, 1, 1, 'Diamond')
    `

    expect(await ranking.queries.getLeaderboard({ mode: '1v1', region: 'EU', page: 1, snapshotId })).toEqual({
      status: 'unavailable',
      reason: 'snapshot_not_found',
      mode: '1v1',
      page: 1,
      pageSize: 20,
    })
    const [stored] = await control<{ finalized: boolean; row_count: number }[]>`
      SELECT generation.finalized, snapshot.row_count
      FROM rankings.generations generation
      JOIN rankings.snapshots snapshot ON snapshot.generation_id = generation.id
      WHERE generation.id = ${generationId}
    `
    expect(stored).toEqual({ finalized: false, row_count: 1 })
    await control.end()
    await ranking.close()
  })

  test('uses schedule windows for latest selection and pins pagination for every mode', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    for (const [modeIndex, mode] of leaderboardModes.entries()) {
      const baseWindow = new Date(Date.now() + (20 + modeIndex * 5) * intervalMs)
      const newer = await leaseOperation(operations, mode, `window-new-${mode}`)
      await ranking.publishGeneration(
        authorization(newer, baseWindow.toISOString()),
        candidate(mode, newer.operationKey, baseWindow, 4, 40 + modeIndex),
      )
      await operations.complete(newer)
      const pageOne = await ranking.queries.getLeaderboard({
        mode,
        region: 'all',
        page: 1,
        pageSize: 5,
        now: baseWindow,
      })
      if (pageOne.status === 'unavailable') throw new Error('Expected page one')

      const older = await leaseOperation(operations, mode, `window-old-${mode}`)
      const olderWindow = new Date(baseWindow.getTime() - intervalMs)
      await ranking.publishGeneration(
        authorization(older, olderWindow.toISOString()),
        candidate(mode, older.operationKey, olderWindow, 4, 50 + modeIndex),
      )
      await operations.complete(older)
      const stillLatest = await ranking.queries.getLeaderboard({
        mode,
        region: 'all',
        page: 1,
        pageSize: 5,
        now: baseWindow,
      })
      if (stillLatest.status === 'unavailable') throw new Error('Expected latest')
      expect(identityName(stillLatest.entries[0])).toContain(`${40 + modeIndex}-`)

      const next = await leaseOperation(operations, mode, `window-next-${mode}`)
      const nextWindow = new Date(baseWindow.getTime() + intervalMs)
      await ranking.publishGeneration(
        authorization(next, nextWindow.toISOString()),
        candidate(mode, next.operationKey, nextWindow, 4, 60 + modeIndex),
      )
      await operations.complete(next)
      const pinned = await ranking.queries.getLeaderboard({
        mode,
        region: 'all',
        page: 2,
        pageSize: 5,
        snapshotId: pageOne.snapshotId,
        now: nextWindow,
      })
      const advanced = await ranking.queries.getLeaderboard({
        mode,
        region: 'all',
        page: 1,
        pageSize: 5,
        now: nextWindow,
      })
      if (pinned.status === 'unavailable' || advanced.status === 'unavailable') throw new Error('Expected pages')
      expect(pinned.generationId).toBe(pageOne.generationId)
      expect(identityName(pinned.entries[0])).toContain(`${40 + modeIndex}-`)
      expect(identityName(advanced.entries[0])).toContain(`${60 + modeIndex}-`)
      expect(
        await ranking.queries.getLeaderboard({ mode, region: 'EU', page: 1, snapshotId: pageOne.snapshotId }),
      ).toMatchObject({
        status: 'unavailable',
        reason: 'snapshot_not_found',
        mode,
      })
    }
    await ranking.close()
    await operations.close()
  })
})

describe('durable multi-mode collection operations', () => {
  test('reconciles four independently staggered schedules concurrently and preserves them on restart', async () => {
    const first = createPostgresRefreshOperations(connectionString)
    const second = createPostgresRefreshOperations(connectionString)
    const base = Date.now() - intervalMs
    const definitions = leaderboardModes.map((mode, index) => ({
      kind: operationKind(mode),
      scheduleKey: `test-schedule:${mode}:${randomUUID()}`,
      operationKeyPrefix: `test:${mode}`,
      workClass: 'leaderboard' as const,
      intervalMs,
      firstDueAt: new Date(base + index * Math.floor(intervalMs / 4)).toISOString(),
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'ranking-postgres-test', requestedBy: 'issue-202' },
    }))
    for (const definition of definitions) {
      const results = await Promise.all([
        first.reconcileLeaderboardSchedule(definition),
        second.reconcileLeaderboardSchedule(definition),
      ])
      expect(results.map(({ outcome }) => outcome).sort()).toEqual(['already-exists', 'created'])
    }
    const control = postgres(connectionString, { max: 1 })
    const rows = await control<{ kind: string; work_class: string; first_due_at: Date }[]>`
      SELECT kind, work_class, first_due_at FROM refresh_operations.schedules
      WHERE schedule_key LIKE 'test-schedule:%'
    `
    expect(new Set(rows.map(({ kind }) => kind))).toEqual(new Set(definitions.map(({ kind }) => kind)))
    expect(rows.every(({ work_class }) => work_class === 'leaderboard')).toBe(true)
    expect(new Set(rows.map(({ first_due_at }) => first_due_at.getTime())).size).toBe(4)
    await Promise.all([first.close(), second.close()])

    const restarted = createPostgresRefreshOperations(connectionString)
    for (const definition of definitions) {
      expect((await restarted.reconcileLeaderboardSchedule(definition)).outcome).toBe('already-exists')
    }
    await restarted.close()
    await control.end()
  })

  test('admits every V1 page with stable attempt/mode/region/page identity before source access', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const sourceAdmission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180, 'brawlhalla-v1': 180 },
    })
    const accepted = await operations.accept({
      kind: 'leaderboard-solo-2v2',
      dedupeKey: `source-admission:${randomUUID()}`,
      operationKey: `source-admission:${randomUUID()}`,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'ranking-postgres-test' },
    })
    const sourceCalls: string[] = []
    expect(
      await runOneDurableOperation(operations, 'source-admission-worker', {
        leaseMs: 10_000,
        retryDelayMs: 0,
        admission,
        sourceAdmission,
        ranking,
        leaderboardSource: {
          async fetchPage(input) {
            sourceCalls.push(`${input.mode}:${input.region}:${input.page}`)
            return validSource('solo2v2').fetchPage(input)
          },
        },
      }),
    ).toBe(true)
    expect(sourceCalls).toEqual(regionalLeaderboardScopes.map((region) => `solo2v2:${region}:1`))
    const control = postgres(connectionString, { max: 1 })
    const reservations = await control<{ domain: string; reservation_key: string }[]>`
      SELECT domain, reservation_key FROM request_admission.source_reservations
      WHERE reservation_key LIKE ${`${accepted.operationId}:%`}
      ORDER BY reservation_key
    `
    expect(reservations).toHaveLength(9)
    expect(reservations.every(({ domain }) => domain === 'brawlhalla-v1')).toBe(true)
    expect(reservations.map(({ reservation_key }) => reservation_key)).toEqual(
      [...regionalLeaderboardScopes].map((region) => `${accepted.operationId}:1:solo2v2:${region}:1`).sort(),
    )
    await control.end()
    await sourceAdmission.close()
    await ranking.close()
    await operations.close()
  })

  test('stops admission, page calls, and publication when the lease is expired and replaced', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const replacementOperations = createPostgresRefreshOperations(connectionString)
    const ranking = createPostgresRanking(connectionString)
    const sourceAdmission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 180, 'brawlhalla-v1': 180 },
    })
    const control = postgres(connectionString, { max: 1 })
    const accepted = await operations.accept({
      kind: 'leaderboard-1v1',
      dedupeKey: `lease-replacement:${randomUUID()}`,
      operationKey: `lease-replacement:${randomUUID()}`,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'ranking-postgres-test' },
    })
    let admissionCalls = 0
    let replacementLease: OperationLease | null = null
    const sourceCalls: string[] = []

    expect(
      await runOneDurableOperation(operations, 'expiring-leaderboard-worker', {
        leaseMs: 10_000,
        renewEveryMs: 60_000,
        retryDelayMs: 0,
        admission,
        sourceAdmission: {
          async admitSource(input) {
            admissionCalls++
            const result = await sourceAdmission.admitSource(input)
            if (admissionCalls === 2) {
              await control`
                UPDATE refresh_operations.operations
                SET lease_expires_at = clock_timestamp() - interval '1 second'
                WHERE id = ${accepted.operationId}
              `
              replacementLease = await replacementOperations.claim(
                'replacement-leaderboard-worker',
                10_000,
                admission,
                'leaderboard-1v1',
              )
              if (!replacementLease || replacementLease.operationId !== accepted.operationId) {
                throw new Error('Expected replacement leaderboard lease')
              }
            }
            return result
          },
          pauseSource: (domain, retryAfterSeconds) => sourceAdmission.pauseSource(domain, retryAfterSeconds),
        },
        ranking,
        leaderboardSource: {
          async fetchPage(input) {
            sourceCalls.push(`${input.mode}:${input.region}:${input.page}`)
            return validSource('1v1').fetchPage(input)
          },
        },
      }),
    ).toBe(true)

    expect(admissionCalls).toBe(2)
    expect(sourceCalls).toEqual(['1v1:US-E:1'])
    const [counts] = await control<{ generations: number; effects: number }[]>`
      SELECT
        (SELECT count(*)::int FROM rankings.generations WHERE operation_id = ${accepted.operationId}) AS generations,
        (SELECT count(*)::int FROM refresh_operations.leaderboard_effects
          WHERE operation_id = ${accepted.operationId}) AS effects
    `
    expect(counts).toEqual({ generations: 0, effects: 0 })
    if (!replacementLease) throw new Error('Expected replacement lease')
    await replacementOperations.fail(
      replacementLease,
      { code: 'test_cleanup', message: 'replacement lease test cleanup', retryable: false },
      0,
    )
    await control.end()
    await sourceAdmission.close()
    await ranking.close()
    await replacementOperations.close()
    await operations.close()
  })
})
