import { describe, expect, test } from 'bun:test'
import { checkDeployedMigrationsPresent, deployedOrder, type Migration, orderMigrations } from '@brawltome/foundation'
import { migrationModules } from '../src/modules'

function migration(identity: string, predecessor: string | null, requires?: readonly string[]): Migration {
  const sql = `SELECT '${identity}';`

  return { identity, predecessor, sql, checksum: 'unchecked', requires }
}

function identities(migrations: readonly Migration[]): string[] {
  return migrations.map(({ identity }) => identity)
}

// deterministic so a failure reproduces
function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items]
  let seed = 7

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    const swapIndex = seed % (index + 1)
    const item = shuffled[index]

    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = item
  }

  return shuffled
}

// the deployed migrations chained per module, so the ordering tests do not depend on the real inventory growing
function deployedFixture(): Migration[] {
  const lastInModule = new Map<string, string>()

  return deployedOrder.map((identity) => {
    const moduleName = identity.split('/')[0]
    const predecessor = lastInModule.get(moduleName) ?? null

    lastInModule.set(moduleName, identity)

    return migration(identity, predecessor)
  })
}

const deployedMigrations = deployedFixture()
const realMigrations = migrationModules.flatMap((module) => module.migrations)
const playersAddition = migration('players/0021', 'players/0020')

describe('orderMigrations', () => {
  test('keeps deployed migrations in their frozen order when the input is shuffled', () => {
    const shuffled = shuffle(deployedMigrations)

    expect(identities(shuffled)).not.toEqual(identities(deployedMigrations))
    expect(identities(orderMigrations(shuffled))).toEqual([...deployedOrder])
  })

  test("starts the modules' migrations with the deployed order, whatever else they hold", () => {
    const ordered = identities(orderMigrations(shuffle(realMigrations)))

    expect(ordered.slice(0, deployedOrder.length)).toEqual([...deployedOrder])
    expect([...ordered].sort()).toEqual(identities(realMigrations).sort())
  })

  test('puts a new migration without requirements after every deployed migration', () => {
    const ordered = orderMigrations(shuffle([playersAddition, ...deployedMigrations]))

    expect(identities(ordered)).toEqual([...deployedOrder, 'players/0021'])
  })

  test('puts a migration after the migrations it requires', () => {
    const statisticsAddition = migration('statistics/0005', 'statistics/0004', ['players/0021'])

    const ordered = orderMigrations([statisticsAddition, playersAddition, ...deployedMigrations])

    expect(identities(ordered).slice(-2)).toEqual(['players/0021', 'statistics/0005'])
  })

  test('puts a migration after a requirement that sorts later alphabetically', () => {
    const statisticsAddition = migration('statistics/0005', 'statistics/0004')
    const accountsAddition = migration('accounts/0010', 'accounts/0009', ['statistics/0005'])

    const ordered = orderMigrations([accountsAddition, statisticsAddition, ...deployedMigrations])

    expect(identities(ordered).slice(-2)).toEqual(['statistics/0005', 'accounts/0010'])
  })

  test('breaks ties between independent new migrations by identity', () => {
    const rankingsAddition = migration('rankings/0013', 'rankings/0012')
    const accountsAddition = migration('accounts/0010', 'accounts/0009')

    const ordered = orderMigrations([rankingsAddition, playersAddition, accountsAddition, ...deployedMigrations])

    expect(identities(ordered).slice(-3)).toEqual(['accounts/0010', 'players/0021', 'rankings/0013'])
  })

  test('orders the deployed migrations that are present when modules are missing', () => {
    const ordered = orderMigrations(shuffle(deployedMigrations.filter(isPlayersOrRankings)))

    expect(identities(ordered)).toEqual(deployedOrder.filter((identity) => isPlayersOrRankings({ identity })))
  })

  test('rejects a requirement cycle and names the migrations in it', () => {
    const statisticsAddition = migration('statistics/0005', 'statistics/0004', ['accounts/0010'])
    const accountsAddition = migration('accounts/0010', 'accounts/0009', ['statistics/0005'])

    expect(() => orderMigrations([statisticsAddition, accountsAddition, ...deployedMigrations])).toThrow(
      'migrations depend on each other in a cycle: accounts/0010 -> statistics/0005 -> accounts/0010',
    )
  })

  test('orders after an optional requirement that is present and ignores one that is absent', () => {
    const statistics = migration('statistics/0001', null)
    const queue = { ...migration('queue/0001', null), requiresIfPresent: ['statistics/0001', 'players/0099'] }

    expect(orderMigrations([queue, statistics]).map(({ identity }) => identity)).toEqual([
      'statistics/0001',
      'queue/0001',
    ])

    expect(orderMigrations([queue]).map(({ identity }) => identity)).toEqual(['queue/0001'])
  })

  test('rejects an unknown requirement and names both migrations', () => {
    const statisticsAddition = migration('statistics/0005', 'statistics/0004', ['players/0099'])

    expect(() => orderMigrations([statisticsAddition, ...deployedMigrations])).toThrow(
      'unknown requirement players/0099 for statistics/0005',
    )
  })

  test('rejects a missing predecessor for a new migration', () => {
    const playersGap = migration('players/0022', 'players/0021')

    expect(() => orderMigrations([playersGap, ...deployedMigrations])).toThrow(
      'missing predecessor players/0021 for players/0022',
    )
  })

  test('rejects a deployed migration that requires a later one', () => {
    const isFirstDeployed = ({ identity }: Migration) => identity === 'players/0001'
    const firstDeployed = deployedMigrations.find(isFirstDeployed)

    if (!firstDeployed) {
      throw new Error('players/0001 is missing from the module migrations')
    }

    const requiringFirst = { ...firstDeployed, requires: ['discovery/0005'] }
    const others = deployedMigrations.filter((migration) => !isFirstDeployed(migration))

    expect(() => orderMigrations([requiringFirst, ...others])).toThrow(
      'deployed migration players/0001 cannot depend on discovery/0005, which does not come before it in the deployed order',
    )
  })
})

describe('checkDeployedMigrationsPresent', () => {
  test('accepts the migrations of every module the runner loads, in any order', () => {
    expect(() => checkDeployedMigrationsPresent(shuffle(realMigrations))).not.toThrow()
  })

  test('rejects a missing deployed migration', () => {
    const withoutRankings = realMigrations.filter(({ identity }) => identity !== 'rankings/0004')

    expect(() => checkDeployedMigrationsPresent(withoutRankings)).toThrow(
      'deployed migration rankings/0004 is missing from the modules',
    )
  })
})

function isPlayersOrRankings({ identity }: { identity: string }): boolean {
  return identity.startsWith('players/') || identity.startsWith('rankings/')
}
