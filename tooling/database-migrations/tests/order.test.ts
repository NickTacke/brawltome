import { describe, expect, test } from 'bun:test'
import type { Migration } from '@brawltome/foundation'
import { deployedOrder } from '../src/deployed-order'
import { globalMigrationInventory } from '../src/inventories'
import { checkDeployedMigrationsPresent, orderMigrations } from '../src/order'

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
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }

  return shuffled
}

const deployedMigrations = [...globalMigrationInventory]
const playersAddition = migration('players/0021', 'players/0020')

describe('orderMigrations', () => {
  test('keeps deployed migrations in their frozen order when the input is shuffled', () => {
    const shuffled = shuffle(deployedMigrations)

    expect(identities(shuffled)).not.toEqual(identities(deployedMigrations))
    expect(identities(orderMigrations(shuffled))).toEqual([...deployedOrder])
  })

  test('orders a shuffled global inventory exactly like the old index list', () => {
    const ordered = orderMigrations(shuffle(globalMigrationInventory))

    expect(identities(ordered)).toEqual(identities(globalMigrationInventory))
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
    const ordered = orderMigrations(shuffle([...globalMigrationInventory.filter(isPlayersOrRankings)]))

    expect(identities(ordered)).toEqual(deployedOrder.filter((identity) => isPlayersOrRankings({ identity })))
  })

  test('rejects a requirement cycle and names the migrations in it', () => {
    const statisticsAddition = migration('statistics/0005', 'statistics/0004', ['accounts/0010'])
    const accountsAddition = migration('accounts/0010', 'accounts/0009', ['statistics/0005'])

    expect(() => orderMigrations([statisticsAddition, accountsAddition, ...deployedMigrations])).toThrow(
      'migrations depend on each other in a cycle: accounts/0010 -> statistics/0005 -> accounts/0010',
    )
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
    const requiringFirst = { ...deployedMigrations[0], requires: ['discovery/0005'] }

    expect(() => orderMigrations([requiringFirst, ...deployedMigrations.slice(1)])).toThrow(
      'deployed migration players/0001 cannot depend on discovery/0005, which does not come before it in the deployed order',
    )
  })
})

describe('checkDeployedMigrationsPresent', () => {
  test('accepts the full deployed set', () => {
    expect(() => checkDeployedMigrationsPresent(shuffle(deployedMigrations))).not.toThrow()
  })

  test('rejects a missing deployed migration', () => {
    const withoutRankings = deployedMigrations.filter(({ identity }) => identity !== 'rankings/0004')

    expect(() => checkDeployedMigrationsPresent(withoutRankings)).toThrow(
      'deployed migration rankings/0004 is missing from the modules',
    )
  })
})

function isPlayersOrRankings({ identity }: { identity: string }): boolean {
  return identity.startsWith('players/') || identity.startsWith('rankings/')
}
