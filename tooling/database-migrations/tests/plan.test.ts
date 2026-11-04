import { describe, expect, mock, test } from 'bun:test'
import type { Migration } from '@brawltome/foundation'
import { type AppliedMigration, buildMigrationPlan, checksumSql } from '../src/plan'
import { runMigrations } from '../src/run'

function migration(identity: string, predecessor: string | null, requires?: readonly string[]): Migration {
  const sql = `SELECT '${identity}';`
  return { identity, predecessor, sql, checksum: checksumSql(sql), requires }
}

const first = migration('players/0001', null)
const second = migration('players/0002', first.identity)

function applied(item: Migration): AppliedMigration {
  return { identity: item.identity, checksum: item.checksum }
}

describe('buildMigrationPlan', () => {
  test('plans pending migrations in deployed order whatever order the input has', () => {
    const accounts = migration('accounts/0001', null)

    expect(buildMigrationPlan([accounts, second, first], [applied(first)])).toEqual({
      pending: [second, accounts],
    })
  })

  test('applies a new migration tail recorded in a different dependency-consistent order', () => {
    const alpha = migration('alpha/0001', null)
    const zeta = migration('zeta/0001', null)
    const zetaFollowUp = migration('zeta/0002', zeta.identity, [alpha.identity])

    expect(buildMigrationPlan([first, alpha, zeta, zetaFollowUp], [applied(first), applied(zeta)])).toEqual({
      pending: [alpha, zetaFollowUp],
    })
  })

  test('rejects a module-subset history once added modules put deployed migrations between its rows', () => {
    const third = migration('players/0003', second.identity)
    const fourth = migration('players/0004', third.identity)
    const refreshOperations = migration('refresh-operations/0001', null)
    const playersOnlyHistory = [first, second, third, fourth].map(applied)

    expect(() => buildMigrationPlan([first, second, third, fourth, refreshOperations], playersOnlyHistory)).toThrow(
      'applied migration players/0004 breaks the deployed order, expected refresh-operations/0001',
    )
  })

  test('rejects malformed or duplicate identities', () => {
    expect(() => buildMigrationPlan([migration('Players/latest', null)], [])).toThrow(
      'invalid migration identity Players/latest',
    )
    expect(() => buildMigrationPlan([first, first], [])).toThrow('duplicate migration identity players/0001')
  })

  test('rejects changed applied checksums', () => {
    expect(() => buildMigrationPlan([first], [{ identity: first.identity, checksum: 'changed' }])).toThrow(
      'checksum mismatch for applied migration players/0001',
    )
  })

  test('rejects missing predecessors and broken owner-local order', () => {
    expect(() => buildMigrationPlan([migration('players/0002', 'players/0001')], [])).toThrow(
      'missing predecessor players/0001 for players/0002',
    )
    expect(() => buildMigrationPlan([first, { ...second, predecessor: null }], [])).toThrow(
      'predecessor <none> for players/0002 does not match owner-local order players/0001',
    )
  })

  test('rejects applied migrations the modules do not know', () => {
    expect(() => buildMigrationPlan([first], [{ identity: 'unknown/0001', checksum: 'unknown' }])).toThrow(
      'applied migration unknown/0001 is not in the modules',
    )
  })

  test('rejects applied migrations recorded before what they depend on', () => {
    const alpha = migration('alpha/0001', null)
    const zeta = migration('zeta/0001', null, [alpha.identity])

    expect(() => buildMigrationPlan([first, second], [applied(second)])).toThrow(
      'applied migration players/0002 depends on players/0001, which was not applied before it',
    )
    expect(() => buildMigrationPlan([alpha, zeta], [applied(zeta), applied(alpha)])).toThrow(
      'applied migration zeta/0001 depends on alpha/0001, which was not applied before it',
    )
  })

  test('rejects deployed migrations applied out of their deployed order', () => {
    const accounts = migration('accounts/0001', null)

    expect(() => buildMigrationPlan([first, accounts], [applied(accounts), applied(first)])).toThrow(
      'applied migration accounts/0001 breaks the deployed order, expected players/0001',
    )
  })

  test('rejects mutated SQL whose declared checksum was not updated', () => {
    expect(() => buildMigrationPlan([{ ...first, sql: 'SELECT 2;' }], [])).toThrow(
      'declared checksum does not match SQL for players/0001',
    )
  })
})

describe('runMigrations', () => {
  test('fails full preflight before executing owner SQL', async () => {
    const invalidInventories: Migration[][] = [
      [first, first],
      [{ ...first, checksum: 'changed' }],
      [migration('players/0002', 'players/0001')],
    ]

    for (const migrations of invalidInventories) {
      const execute = mock(async () => {})
      await expect(runMigrations({ migrations, loadApplied: async () => [], execute })).rejects.toThrow()
      expect(execute).not.toHaveBeenCalled()
    }
  })

  test('rejects changed checksums and partial history before executing owner SQL', async () => {
    const invalidHistories: AppliedMigration[][] = [
      [{ identity: first.identity, checksum: 'changed' }],
      [applied(second)],
    ]

    for (const history of invalidHistories) {
      const execute = mock(async () => {})
      await expect(
        runMigrations({ migrations: [first, second], loadApplied: async () => history, execute }),
      ).rejects.toThrow()
      expect(execute).not.toHaveBeenCalled()
    }
  })

  test('executes only pending migrations in order', async () => {
    const execute = mock(async () => {})

    await runMigrations({ migrations: [first, second], loadApplied: async () => [applied(first)], execute })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(second, 2)
  })
})
