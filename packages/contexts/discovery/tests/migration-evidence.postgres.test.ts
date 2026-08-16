import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type {
  ClanProjectionSource,
  MigrationEvidenceInput,
  PlayerProjectionSource,
  ReconciliationResult,
} from '@brawltome/discovery'
import { createPostgresDiscovery, discoveryMigrationInventory } from '@brawltome/discovery/composition'
import postgres from 'postgres'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `bt_discovery_evidence_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

beforeAll(async () => {
  const configured = new URL(configuredServer ?? '')
  const dedicated = new URL(dedicatedServer)
  if (
    configured.protocol !== dedicated.protocol ||
    configured.hostname !== dedicated.hostname ||
    configured.port !== dedicated.port ||
    configured.username !== dedicated.username ||
    configured.password !== dedicated.password
  ) {
    throw new Error(`Discovery PostgreSQL tests require the dedicated server ${dedicatedServer}`)
  }
  const adminUrl = new URL(dedicatedServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of discoveryMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
})

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

const playerSource: PlayerProjectionSource = {
  pendingEvents: async () => [],
  acknowledgeEvents: async () => {},
  snapshot: async () => ({ sourceVersion: 4, pendingEventCount: 0, oldestPendingAt: null, facts: [] }),
  lag: async () => 0,
}
const clanSource: ClanProjectionSource = {
  pendingEvents: async () => [],
  acknowledgeEvents: async () => {},
  snapshot: async () => ({ sourceVersion: 4, pendingEventCount: 0, oldestPendingAt: null, facts: [] }),
  lag: async () => 0,
}

async function exactReconciliations(discovery: ReturnType<typeof createPostgresDiscovery>): Promise<{
  player: ReconciliationResult
  clan: ReconciliationResult
}> {
  await Promise.all([discovery.rebuildPlayersFrom(playerSource), discovery.rebuildClansFrom(clanSource)])
  const [player, clan] = await Promise.all([
    discovery.reconcilePlayers(playerSource),
    discovery.reconcileClans(clanSource),
  ])
  return { player, clan }
}

const passingInput = (reconciliations: {
  player: ReconciliationResult
  clan: ReconciliationResult
}): MigrationEvidenceInput => ({
  operationKey: 'issue-225-fixture',
  sourceEvidenceHash: 'a'.repeat(64),
  playerReconciliation: reconciliations.player,
  clanReconciliation: reconciliations.clan,
  pendingPlayerEvents: 0,
  pendingClanEvents: 0,
  fixtures: [
    {
      key: 'player:42:canonical',
      kind: 'canonical-identity' as const,
      expected: { entityKind: 'player', entityId: 42 },
      legacy: { entityKind: 'player', entityId: 42 },
      actual: { entityKind: 'player', entityId: 42 },
      explanationCode: null,
    },
    {
      key: 'search:prefix',
      kind: 'exact-prefix' as const,
      expected: [42],
      legacy: [42],
      actual: [42],
      explanationCode: null,
    },
    {
      key: 'search:normalized',
      kind: 'normalized-exact-name' as const,
      expected: [42],
      legacy: [42],
      actual: [42],
      explanationCode: null,
    },
    {
      key: 'search:local-name',
      kind: 'local-name' as const,
      expected: [42],
      legacy: [42],
      actual: [42],
      explanationCode: null,
    },
    {
      key: 'player:-1:legacy-only',
      kind: 'negative-legacy-only' as const,
      expected: false,
      legacy: true,
      actual: false,
      explanationCode: 'legacy-only-not-owner-fact' as const,
    },
    {
      key: 'player:42:route',
      kind: 'preserved-route' as const,
      expected: { entityKind: 'player', entityId: 42 },
      legacy: { entityKind: 'player', entityId: 42 },
      actual: { entityKind: 'player', entityId: 42 },
      explanationCode: null,
    },
    {
      key: 'ranking:accepted',
      kind: 'ranking-accepted' as const,
      expected: [{ standing: 1, entityId: 42 }],
      legacy: [{ standing: 1, entityId: 42 }],
      actual: [{ standing: 1, entityId: 42 }],
      explanationCode: null,
    },
    {
      key: 'ranking:rejected',
      kind: 'ranking-rejected' as const,
      expected: null,
      legacy: { reasons: ['incomplete'] },
      actual: null,
      explanationCode: 'ranking-set-rejected' as const,
    },
  ],
})

describe('Discovery semantic migration evidence', () => {
  test('commits a passing zero-tolerance result once under replay and concurrency', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    try {
      const input = passingInput(await exactReconciliations(discovery))
      const [first, concurrent] = await Promise.all([
        discovery.commitMigrationEvidence(input),
        discovery.commitMigrationEvidence({ ...input, fixtures: [...input.fixtures].reverse() }),
      ])
      expect(concurrent).toEqual(first)
      expect(first).toMatchObject({
        status: 'passed',
        sourceEvidenceHash: 'a'.repeat(64),
        fixtureCount: 8,
        intentionalDifferenceCount: 2,
        unexplainedMismatchCount: 0,
        mismatchDetailsTruncated: false,
      })
      expect(await discovery.commitMigrationEvidence(input)).toEqual(first)

      const rejectedOnly = passingInput({
        player: input.playerReconciliation,
        clan: input.clanReconciliation,
      })
      rejectedOnly.operationKey = 'issue-225-rejected-rankings-only'
      rejectedOnly.fixtures = rejectedOnly.fixtures.filter(({ kind }) => kind !== 'ranking-accepted')
      await expect(discovery.commitMigrationEvidence(rejectedOnly)).resolves.toMatchObject({ status: 'passed' })
    } finally {
      await discovery.close()
    }
  })

  test('persists bounded deterministic mismatch evidence and blocks launch', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    const input = passingInput(await exactReconciliations(discovery))
    input.operationKey = 'issue-225-blocked'
    input.fixtures.push(
      ...Array.from({ length: 1_005 }, (_, index) => ({
        key: `player:${index + 1}:route-mismatch`,
        kind: 'canonical-identity' as const,
        expected: { entityKind: 'player' as const, entityId: index + 1 },
        legacy: { entityKind: 'player' as const, entityId: index + 1 },
        actual: null,
        explanationCode: null,
      })),
    )
    try {
      const result = await discovery.commitMigrationEvidence(input)
      expect(result).toMatchObject({
        status: 'blocked',
        fixtureCount: 1_013,
        unexplainedMismatchCount: 1_005,
        mismatchDetailCount: 1_000,
        mismatchDetailsTruncated: true,
      })
      const orderedMismatchKeys = input.fixtures
        .filter(({ actual }) => actual === null)
        .map(({ key }) => key)
        .sort()
      expect(result.mismatches[0]?.fixtureKey).toBe(orderedMismatchKeys[0])
      expect(result.mismatches.at(-1)?.fixtureKey).toBe(orderedMismatchKeys[999])
    } finally {
      await discovery.close()
    }
  })

  test('rejects invalid explanation codes and residual projection or lag failures', async () => {
    const discovery = createPostgresDiscovery(connectionString)
    try {
      const reconciliations = await exactReconciliations(discovery)
      const invalidExplanation = passingInput(reconciliations)
      invalidExplanation.operationKey = 'issue-225-invalid-explanation'
      invalidExplanation.fixtures[4] = {
        ...invalidExplanation.fixtures[4],
        explanationCode: 'normalized-exact-name' as never,
      }
      await expect(discovery.commitMigrationEvidence(invalidExplanation)).rejects.toThrow(
        'Explanation code does not match semantic fixture kind',
      )

      const residualLag = passingInput(reconciliations)
      residualLag.operationKey = 'issue-225-residual-lag'
      residualLag.pendingPlayerEvents = 1
      await expect(discovery.commitMigrationEvidence(residualLag)).rejects.toThrow(
        'Discovery migration evidence requires zero owner lag',
      )

      const incompleteCoverage = passingInput(reconciliations)
      incompleteCoverage.operationKey = 'issue-225-incomplete-coverage'
      incompleteCoverage.fixtures = incompleteCoverage.fixtures.slice(0, 1)
      await expect(discovery.commitMigrationEvidence(incompleteCoverage)).rejects.toThrow(
        'Discovery migration fixture coverage is missing',
      )

      const unauthorizedOwners = passingInput(reconciliations)
      unauthorizedOwners.operationKey = 'issue-225-owner-changed'
      await expect(discovery.commitMigrationEvidence(unauthorizedOwners, async () => false)).rejects.toThrow(
        'Discovery owner facts changed before evidence commit',
      )

      const forgedReconciliation = passingInput(reconciliations)
      forgedReconciliation.operationKey = 'issue-225-forged-reconciliation'
      forgedReconciliation.playerReconciliation = {
        ...forgedReconciliation.playerReconciliation,
        expectedHash: 'b'.repeat(64),
        projectedHashAfter: 'b'.repeat(64),
      }
      await expect(discovery.commitMigrationEvidence(forgedReconciliation)).rejects.toThrow(
        'Discovery migration evidence does not match stored reconciliation',
      )

      const staleProjection = passingInput(reconciliations)
      staleProjection.operationKey = 'issue-225-stale-projection'
      await discovery.rebuildPlayers({
        sourceVersion: 5,
        facts: [
          {
            brawlhallaId: 42,
            name: 'Changed After Reconciliation',
            region: null,
            rating: null,
            viewCount: 0,
            bestLegendNameKey: null,
            aliases: [],
          },
        ],
      })
      await expect(discovery.commitMigrationEvidence(staleProjection)).rejects.toThrow(
        'Discovery migration evidence does not match the active projection',
      )

      const sparseFixture = passingInput({
        player: await discovery.reconcilePlayers({
          ...playerSource,
          snapshot: async () => ({
            sourceVersion: 5,
            pendingEventCount: 0,
            oldestPendingAt: null,
            facts: [
              {
                brawlhallaId: 42,
                name: 'Changed After Reconciliation',
                region: null,
                rating: null,
                viewCount: 0,
                bestLegendNameKey: null,
                aliases: [],
              },
            ],
          }),
        }),
        clan: reconciliations.clan,
      })
      sparseFixture.operationKey = 'issue-225-sparse-array'
      sparseFixture.fixtures[0] = { ...sparseFixture.fixtures[0], expected: Array(1) }
      await expect(discovery.commitMigrationEvidence(sparseFixture)).rejects.toThrow(
        'Discovery migration fixture arrays must not be sparse',
      )
    } finally {
      await discovery.close()
    }
  })
})
