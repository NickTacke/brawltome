import { describe, expect, test } from 'bun:test'
import { accountsModule } from '@brawltome/accounts'
import { type BrawltomeModule, checkModuleList } from '@brawltome/foundation'
import { playerModule } from '@brawltome/player'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import { replayAnalysisModule } from '@brawltome/replay-analysis'
import { apiModules } from '../src/modules'
import { workerModules } from '../src/worker-modules'

function without(modules: readonly BrawltomeModule[], left: BrawltomeModule): BrawltomeModule[] {
  return modules.filter((module) => module !== left)
}

function fakeModule(name: string, dependsOn: readonly string[]): BrawltomeModule {
  return { name, dependsOn, migrations: [] }
}

describe('module lists', () => {
  test('the API loads exactly these modules', () => {
    const names = apiModules.map((module) => module.name)

    expect(names).toEqual([
      'accounts',
      'refresh-operations',
      'request-admission',
      'player',
      'clan',
      'discovery',
      'ranking',
      'statistics',
      'replay-analysis',
    ])
  })

  test('the operations worker loads exactly these modules', () => {
    const names = workerModules.map((module) => module.name)

    expect(names).toEqual([
      'accounts',
      'refresh-operations',
      'request-admission',
      'player',
      'clan',
      'discovery',
      'ranking',
      'statistics',
    ])
  })

  test('the API loads every module its modules depend on', () => {
    expect(() => checkModuleList(apiModules)).not.toThrow()
  })

  test('the operations worker loads every module its modules depend on', () => {
    expect(() => checkModuleList(workerModules)).not.toThrow()
  })

  test('leaving out a module nothing depends on still passes', () => {
    expect(() => checkModuleList(without(apiModules, replayAnalysisModule))).not.toThrow()
  })

  test('leaving out a module others depend on names a dependant', () => {
    expect(() => checkModuleList(without(apiModules, refreshOperationsModule))).toThrow(
      'module player depends on refresh-operations, which is not loaded',
    )
    expect(() => checkModuleList(without(apiModules, accountsModule))).toThrow(
      'module replay-analysis depends on accounts, which is not loaded',
    )
  })

  test('rejects a module listed twice', () => {
    expect(() => checkModuleList([...apiModules, playerModule])).toThrow('module player is listed twice')
  })

  test('rejects modules that depend on each other in a cycle', () => {
    const modules = [fakeModule('alpha', ['beta']), fakeModule('beta', ['gamma']), fakeModule('gamma', ['beta'])]

    expect(() => checkModuleList(modules)).toThrow('modules depend on each other in a cycle: beta -> gamma -> beta')
  })

  test('rejects a module that depends on itself', () => {
    expect(() => checkModuleList([fakeModule('alpha', ['alpha'])])).toThrow(
      'modules depend on each other in a cycle: alpha -> alpha',
    )
  })
})
