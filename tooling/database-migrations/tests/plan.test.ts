import { describe, expect, mock, test } from 'bun:test'
import { type AppliedMigration, type Migration, buildMigrationPlan, checksumSql } from '../src/plan'
import { runMigrations } from '../src/run'

function migration(identity: string, predecessor: string | null, sql = `SELECT '${identity}';`): Migration {
  return { identity, predecessor, sql, checksum: checksumSql(sql) }
}

const first = migration('players/0001', null)
const second = migration('players/0002', first.identity)

function applied(item: Migration): AppliedMigration {
  return { identity: item.identity, checksum: item.checksum }
}

describe('buildMigrationPlan', () => {
  test('uses tooling order without leaking cross-capability predecessors into owner inventories', () => {
    const accounts = migration('accounts/0001', null)

    expect(buildMigrationPlan([first, accounts, second], [applied(first)])).toEqual({
      pending: [accounts, second],
    })
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

  test('rejects partial or divergent applied plans', () => {
    expect(() => buildMigrationPlan([first, second], [applied(second)])).toThrow(
      'applied migration players/0002 does not match expected prefix players/0001',
    )
    expect(() => buildMigrationPlan([first], [{ identity: 'unknown/0001', checksum: 'unknown' }])).toThrow(
      'applied migration unknown/0001 does not match expected prefix players/0001',
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
