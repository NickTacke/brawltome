import { describe, expect, test } from 'bun:test'
import type { Migration } from '../migration'
import { checksumSql } from '../migrations/plan'
import { type BrawltomeModule, checkModuleList } from '../module'

function migration(identity: string, predecessor: string | null): Migration {
  const sql = `SELECT '${identity}'`

  return { identity, predecessor, sql, checksum: checksumSql(sql) }
}

function dependent(name: string, dependsOn: readonly string[]): BrawltomeModule {
  return { name, dependsOn, migrations: [] }
}

function moduleWith(name: string, identities: readonly string[]): BrawltomeModule {
  const migrations = identities.map((identity, index) => migration(identity, identities[index - 1] ?? null))

  return { name, dependsOn: [], migrations }
}

describe('checkModuleList migration owners', () => {
  test('accepts modules that each own one prefix', () => {
    const modules = [moduleWith('player', ['players/0001', 'players/0002']), moduleWith('clan', ['clans/0001'])]

    expect(() => checkModuleList(modules)).not.toThrow()
  })

  test('accepts a module without migrations', () => {
    expect(() => checkModuleList([moduleWith('empty', [])])).not.toThrow()
  })

  test('rejects a module whose migrations use more than one owner', () => {
    const modules = [moduleWith('player', ['players/0001', 'clans/0001'])]

    expect(() => checkModuleList(modules)).toThrow(
      'module player has migrations under more than one owner: players, clans',
    )
  })

  test('rejects two modules that share an owner', () => {
    const modules = [moduleWith('player', ['players/0001']), moduleWith('player-copy', ['players/0002'])]

    expect(() => checkModuleList(modules)).toThrow('modules player and player-copy both own migrations under players')
  })
})

describe('checkModuleList dependencies', () => {
  test('rejects a dependency that is not loaded', () => {
    expect(() => checkModuleList([dependent('player', ['refresh-operations'])])).toThrow(
      'module player depends on refresh-operations, which is not loaded',
    )
  })

  test('rejects a module listed twice', () => {
    expect(() => checkModuleList([dependent('player', []), dependent('player', [])])).toThrow(
      'module player is listed twice',
    )
  })

  test('rejects modules that depend on each other in a cycle', () => {
    const modules = [dependent('alpha', ['beta']), dependent('beta', ['gamma']), dependent('gamma', ['beta'])]

    expect(() => checkModuleList(modules)).toThrow('modules depend on each other in a cycle: beta -> gamma -> beta')
  })

  test('rejects a module that depends on itself', () => {
    expect(() => checkModuleList([dependent('alpha', ['alpha'])])).toThrow(
      'modules depend on each other in a cycle: alpha -> alpha',
    )
  })
})
